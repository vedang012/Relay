from concurrent.futures import ThreadPoolExecutor
from sqlalchemy import func, select
from app.models import ActivityEvent, Approval, WorkItem


def auth(client, name):
    response = client.post('/api/v1/auth/login', json={'email': f'{name}@example.test', 'password': 'correct-password-123'})
    assert response.status_code == 200
    return {'Authorization': 'Bearer ' + response.json()['access_token']}


def create(client, ids, headers, key=None, **extra):
    body = {'team_id': ids['team_a'], 'title': 'An issue', 'type': 'INCIDENT'} | extra
    h = headers | ({'Idempotency-Key': key} if key else {})
    return client.post('/api/v1/work-items', json=body, headers=h)


def test_auth_and_scope(context):
    client, ids, _ = context
    assert client.get('/api/v1/work-items').status_code == 401
    assert client.post('/api/v1/auth/login', json={'email':'lead@example.test','password':'wrong'}).status_code == 401
    lead = auth(client, 'lead')
    assert client.get('/api/v1/auth/me', headers=lead).status_code == 200
    item = create(client, ids, lead).json()
    outsider = auth(client, 'outsider')
    assert client.get(f"/api/v1/work-items/{item['id']}", headers=outsider).status_code == 404
    assert client.patch(f"/api/v1/work-items/{item['id']}", json={'version':1,'title':'stolen'}, headers=outsider).status_code == 404
    assert client.get('/api/v1/work-items', headers=outsider).json()['total'] == 0
    engineer = auth(client, 'engineer')
    assert client.post(f"/api/v1/work-items/{item['id']}/assignments", json={'version':1,'user_id':ids['engineer'],'role':'OWNER'}, headers=engineer).status_code == 403


def test_workflow_locking_and_history(context):
    client, ids, session = context
    h = auth(client, 'lead')
    item = create(client, ids, h).json(); path = f"/api/v1/work-items/{item['id']}"
    assert client.post(path+'/transitions', json={'version':1,'status':'CLOSED'}, headers=h).status_code == 422
    changed = client.post(path+'/transitions', json={'version':1,'status':'IN_PROGRESS'}, headers=h)
    assert changed.status_code == 200 and changed.json()['version'] == 2
    assert client.patch(path, json={'version':1,'title':'stale'}, headers=h).status_code == 409
    assert client.patch(path, json={'version':2,'next_action':None}, headers=h).status_code == 200
    with session() as db:
        assert db.scalar(select(func.count()).select_from(ActivityEvent).where(ActivityEvent.work_item_id == item['id'])) == 3
        assert db.get(WorkItem, item['id']).title == 'An issue'


def test_idempotency_listing_and_attention(context):
    client, ids, session = context
    h = auth(client, 'lead')
    first = create(client, ids, h, key='same-key')
    assert first.status_code == 201
    again = create(client, ids, h, key='same-key')
    assert again.status_code == 201 and again.json()['id'] == first.json()['id']
    assert create(client, ids, h, key='same-key', title='Different').status_code == 409
    assert create(client, ids, h, title='Second').status_code == 201
    listing = client.get('/api/v1/work-items?page_size=1&sort=title', headers=h)
    assert listing.status_code == 422
    listing = client.get('/api/v1/work-items?page_size=1', headers=h).json()
    assert listing['total'] == 2 and len(listing['items']) == 1
    attention = client.get('/api/v1/dashboard/attention', headers=h).json()
    assert attention['total'] == 2
    assert all('UNASSIGNED' in row['reasons'] for row in attention['items'])
    with session() as db:
        assert db.scalar(select(func.count()).select_from(WorkItem)) == 2


def test_approval_separation_and_stale_decision(context):
    client, ids, session = context
    lead = auth(client, 'lead'); admin = auth(client, 'admin'); finance = auth(client, 'finance')
    item = create(client, ids, lead).json()
    request = client.post('/api/v1/approvals', json={'work_item_id':item['id'],'version':1,'type':'PAYMENT','reason':'Review', 'approver_id':ids['finance']}, headers=lead)
    assert request.status_code == 201
    approval = request.json()
    path = f"/api/v1/approvals/{approval['id']}/decision"
    assert client.post(path, json={'version':1,'status':'APPROVED'}, headers=admin).status_code == 403
    assert client.post(path, json={'version':1,'status':'APPROVED'}, headers=lead).status_code == 403
    assert client.post(path, json={'version':1,'status':'APPROVED'}, headers=finance).status_code == 200
    assert client.post(path, json={'version':1,'status':'REJECTED'}, headers=finance).status_code == 409
    with session() as db:
        assert db.get(Approval, approval['id']).status == 'APPROVED'
        assert db.scalar(select(func.count()).select_from(ActivityEvent).where(ActivityEvent.work_item_id == item['id'])) == 3


def test_competing_updates(context):
    client, ids, session = context
    h = auth(client, 'lead')
    item = create(client, ids, h).json()
    path = f"/api/v1/work-items/{item['id']}"
    def change(title): return client.patch(path, json={'version':1,'title':title}, headers=h).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(change, ['A','B']))
    assert sorted(statuses) == [200,409]
    with session() as db:
        assert db.get(WorkItem, item['id']).version == 2
        assert db.scalar(select(func.count()).select_from(ActivityEvent).where(ActivityEvent.work_item_id == item['id'])) == 2


def test_invalid_expired_and_inactive_auth(context):
    from datetime import datetime, timedelta, timezone
    import jwt
    from app.core.config import get_settings
    from app.models import User
    client, ids, session = context
    settings = get_settings()
    expired = jwt.encode({'sub': ids['lead'], 'iat': datetime.now(timezone.utc)-timedelta(hours=2), 'exp': datetime.now(timezone.utc)-timedelta(hours=1)}, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    assert client.get('/api/v1/auth/me', headers={'Authorization': f'Bearer {expired}'}).status_code == 401
    with session() as db:
        user = db.get(User, ids['lead']); user.active = False; db.commit()
    assert client.post('/api/v1/auth/login', json={'email':'lead@example.test','password':'correct-password-123'}).status_code == 401
    assert client.get('/api/v1/auth/me', headers={'Authorization': 'Bearer '+jwt.encode({'sub':ids['lead'], 'iat':datetime.now(timezone.utc), 'exp':datetime.now(timezone.utc)+timedelta(hours=1)}, settings.jwt_secret, algorithm=settings.jwt_algorithm)}).status_code == 401


def test_competing_approval_decisions(context):
    client, ids, session = context
    lead = auth(client, 'lead'); finance = auth(client, 'finance')
    item = create(client, ids, lead).json()
    approval = client.post('/api/v1/approvals', json={'work_item_id': item['id'], 'version': 1, 'type':'PAYMENT', 'reason':'Review'}, headers=lead).json()
    path = f"/api/v1/approvals/{approval['id']}/decision"
    def decide(status): return client.post(path, json={'version':1,'status':status}, headers=finance).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(decide, ['APPROVED','REJECTED']))
    assert sorted(statuses) == [200,409]
    with session() as db:
        assert db.get(Approval, approval['id']).version == 2
        assert db.scalar(select(func.count()).select_from(ActivityEvent).where(ActivityEvent.work_item_id == item['id'])) == 3


def test_competing_idempotent_creations(context):
    client, ids, session = context
    lead = auth(client, 'lead')
    def send(_): return create(client, ids, lead, key='competing-create')
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(send, range(2)))
    assert [response.status_code for response in responses] == [201,201]
    assert responses[0].json()['id'] == responses[1].json()['id']
    with session() as db:
        assert db.scalar(select(func.count()).select_from(WorkItem)) == 1


def test_dashboard_multiple_reasons_and_team_filter(context):
    client, ids, _ = context
    lead = auth(client, 'lead'); outsider = auth(client, 'outsider')
    item = create(client, ids, lead, due_at='2020-01-01T00:00:00Z').json()
    changed = client.post(f"/api/v1/work-items/{item['id']}/transitions", json={'version':1,'status':'IN_PROGRESS'}, headers=lead).json()
    client.post(f"/api/v1/work-items/{item['id']}/transitions", json={'version':2,'status':'BLOCKED'}, headers=lead)
    response = client.get('/api/v1/dashboard/attention', headers=lead).json()
    assert response['total'] == 1
    assert {'OVERDUE','BLOCKED','UNASSIGNED'}.issubset(response['items'][0]['reasons'])
    assert client.get('/api/v1/dashboard/attention', headers=outsider).json()['total'] == 0
