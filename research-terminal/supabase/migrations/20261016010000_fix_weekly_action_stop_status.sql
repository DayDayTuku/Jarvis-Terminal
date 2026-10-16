-- Repair rows created by the old intraday monitor bug.
--
-- Previously, after a stop-out was recorded the monitor could still evaluate the
-- take-profit branch on a later run (the week's high/low only ever grow), so a
-- "cut" was relabelled as a "hit": action='REDUCE', target_reached=true, while
-- invalidated stayed true. A genuinely stopped trade therefore looked like a
-- winner.
--
-- A row is the bug only when it was stopped AND re-tagged as a target AND the
-- action is still REDUCE. (A real take-profit followed by a stop would already
-- read action='EXIT'.) Restore it to a clean, terminal stop.
--
-- The [stop-alert:sent] marker is re-added on purpose: the monitor reads it to
-- avoid sending the same alert email twice, and the bug overwrote it.

update public.jarvis_weekly_actions
set action = 'EXIT',
    target_weight = 0,
    target_reached = false,
    entry_filled = true,
    reason = 'Price traded through the active stop level. [stop-alert:sent]'
where invalidated is true
  and target_reached is true
  and action = 'REDUCE';

-- NOTE: do NOT strip the [stop|target]-alert:sent markers from reason here.
-- The monitor relies on them for de-duplication. They are stripped for display
-- in the UI, the emails, the DOCX export, and the public API instead.
