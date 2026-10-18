"""Shared workflow rules for mutations and client capabilities."""

TRANSITIONS = {
    "OPEN": ("IN_PROGRESS",),
    "IN_PROGRESS": ("BLOCKED", "RESOLVED"),
    "BLOCKED": ("IN_PROGRESS",),
    "RESOLVED": ("CLOSED", "IN_PROGRESS"),
    "CLOSED": (),
}
