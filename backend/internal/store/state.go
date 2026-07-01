package store

// PollerState is the single-row high-water mark the live poller advances so it
// only ever processes posts newer than the last one it saw.
type PollerState struct {
	LastPostID int64  `json:"last_post_id"`
	LastPollAt string `json:"last_poll_at"`
	LastError  string `json:"last_error"`
}

func (s *Store) GetPollerState() (PollerState, error) {
	var st PollerState
	var lastPoll, lastErr *string
	err := s.db.QueryRow(`SELECT last_post_id, last_poll_at, last_error FROM poller_state WHERE id = 1`).
		Scan(&st.LastPostID, &lastPoll, &lastErr)
	if err != nil {
		return PollerState{}, err
	}
	if lastPoll != nil {
		st.LastPollAt = *lastPoll
	}
	if lastErr != nil {
		st.LastError = *lastErr
	}
	return st, nil
}

func (s *Store) SetLastPostID(id int64) error {
	_, err := s.db.Exec(`UPDATE poller_state SET last_post_id = ? WHERE id = 1`, id)
	return err
}

func (s *Store) SetPollResult(lastErr string) error {
	_, err := s.db.Exec(`UPDATE poller_state SET last_poll_at = ?, last_error = ? WHERE id = 1`, nowUTC(), lastErr)
	return err
}

// Stats is the dashboard overview snapshot.
type Stats struct {
	TotalChecked    int    `json:"total_checked"`
	TotalViolations int    `json:"total_violations"`
	TotalHidden     int    `json:"total_hidden"`
	FlaggedUsers    int    `json:"flagged_users"`
	LastPollAt      string `json:"last_poll_at"`
	LastPostID      int64  `json:"last_post_id"`
	LastError       string `json:"last_error"`
}

// GetStats returns the overview counts. When platform is non-empty ("flarum" |
// "xenforo"), the moderation counts are filtered to that forum.
func (s *Store) GetStats(platform string) (Stats, error) {
	var st Stats
	cond, args := "", []any{}
	if platform != "" {
		cond = " AND platform = ?"
		args = append(args, platform)
	}
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM moderation_logs WHERE 1=1`+cond, args...).Scan(&st.TotalChecked)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM moderation_logs WHERE violation = 1`+cond, args...).Scan(&st.TotalViolations)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM moderation_logs WHERE action_taken LIKE '%hidden%'`+cond, args...).Scan(&st.TotalHidden)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM user_strikes WHERE status != 'active'`).Scan(&st.FlaggedUsers)
	ps, err := s.GetPollerState()
	if err != nil {
		return st, err
	}
	st.LastPollAt = ps.LastPollAt
	st.LastPostID = ps.LastPostID
	st.LastError = ps.LastError
	return st, nil
}
