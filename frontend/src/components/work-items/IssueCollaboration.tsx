import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, MessageSquare, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../../api";
import { Feedback, Pager } from "../../ui";

export function BookmarkButton({ id }: { id: string }) {
  const cache = useQueryClient();
  const state = useQuery({
    queryKey: ["bookmark", id],
    queryFn: () => api.bookmark(id),
  });
  const mutation = useMutation({
    mutationFn: (saved: boolean) => api.setBookmark(id, saved),
    onSuccess: (_, saved) => {
      cache.setQueryData(["bookmark", id], {
        bookmarked: saved,
      });
      void cache.invalidateQueries({ queryKey: ["items"] });
    },
  });
  return (
    <div>
      <button
        className={state.data?.bookmarked ? "bookmark saved" : "bookmark"}
        aria-pressed={!!state.data?.bookmarked}
        disabled={!state.data || mutation.isPending}
        onClick={() => mutation.mutate(!state.data?.bookmarked)}
      >
        <Bookmark
          size={17}
          fill={state.data?.bookmarked ? "currentColor" : "none"}
        />
        {state.data?.bookmarked ? "Bookmarked" : "Bookmark issue"}
      </button>
      {(state.error || mutation.error) && (
        <Feedback error={state.error || mutation.error} />
      )}
    </div>
  );
}

export function IssueDiscussion({ id }: { id: string }) {
  const cache = useQueryClient();
  const [body, setBody] = useState("");
  const [page, setPage] = useState(1);
  const submitting = useRef(false);
  const [posted, setPosted] = useState(false);
  const comments = useQuery({
    queryKey: ["comments", id, page],
    queryFn: () => api.comments(id, page),
  });
  const mutation = useMutation({
    mutationFn: (text: string) => api.comment(id, text),
    onSuccess: () => {
      setBody("");
      setPage(1);
      setPosted(true);
      void cache.invalidateQueries({ queryKey: ["comments", id] });
      void cache.invalidateQueries({ queryKey: ["activity", id] });
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  return (
    <section className="panel padded" aria-label="Issue comments">
      <h2 className="icon-heading">
        <MessageSquare size={18} /> Comments
      </h2>
      <p className="muted">
        Discuss this issue with your team. Newest comments appear first.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim() || submitting.current) return;
          submitting.current = true;
          setPosted(false);
          mutation.mutate(body.trim());
        }}
      >
        <label htmlFor="issue-comment">Add a comment</label>
        <textarea
          id="issue-comment"
          required
          maxLength={10000}
          rows={3}
          placeholder="Share an update or ask a question…"
          value={body}
          disabled={mutation.isPending}
          onChange={(e) => {
            setBody(e.target.value);
            setPosted(false);
          }}
        />
        <div className="section-bar">
          <small className="muted">
            {body.length.toLocaleString()} / 10,000 characters
          </small>
          <button
            className="primary"
            disabled={mutation.isPending || !body.trim()}
          >
            {mutation.isPending ? "Posting…" : "Post comment"}
          </button>
        </div>
      </form>
      {posted && <p role="status">Comment posted.</p>}
      {mutation.error && <Feedback error={mutation.error} />}
      {comments.isPending ? (
        <p role="status">Loading comments…</p>
      ) : comments.error ? (
        <Feedback error={comments.error} />
      ) : (
        <>
          {!comments.data?.items.length && (
            <p className="muted">No comments yet. Start the discussion.</p>
          )}
          <div className="comment-list">
            {comments.data?.items.map((c) => (
              <article className="issue-comment" key={c.id}>
                <div className="section-bar">
                  <strong>{c.author_name}</strong>
                  <time dateTime={c.created_at}>
                    {new Date(c.created_at).toLocaleString()}
                  </time>
                </div>
                <p className="body-copy">{c.body}</p>
              </article>
            ))}
          </div>
          <Pager
            page={page}
            size={comments.data?.page_size || 20}
            total={comments.data?.total || 0}
            onChange={setPage}
          />
        </>
      )}
    </section>
  );
}

export function IssueSummaryPanel({ id }: { id: string }) {
  const summary = useMutation({ mutationFn: () => api.summarize(id) });
  return (
    <section className="panel padded summary-panel" aria-label="Issue summary">
      <div className="section-bar">
        <h2 className="icon-heading">
          <Sparkles size={18} /> Issue at a glance
        </h2>
        <button disabled={summary.isPending} onClick={() => summary.mutate()}>
          {summary.isPending
            ? "Summarizing…"
            : summary.data
              ? "Refresh summary"
              : "Summarize issue"}
        </button>
      </div>
      <p className="muted">
        A single paragraph of 100–150 words, generated by Groq from issue
        details and recent comments. Generating sends that content to Groq.
      </p>
      {summary.isPending && <p role="status">Preparing your summary…</p>}
      {summary.error && <Feedback error={summary.error} />}
      {summary.data && (
        <>
          <p className="summary-paragraph" role="status">
            {summary.data.summary}
          </p>
          <small className="muted">
            {summary.data.context_note} Generated on request; refresh after
            updates. Review AI summaries for accuracy.
          </small>
        </>
      )}
    </section>
  );
}
