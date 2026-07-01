package store

// Strike tracks per-user violation accumulation for "phạt nguội" (delayed
// enforcement): repeated violations raise the strike count and can flag a user
// for suspension.
type Strike struct {
	UserID          int64  `json:"user_id"`
	Username        string `json:"username"`
	Strikes         int    `json:"strikes"`
	LastViolationAt string `json:"last_violation_at"`
	Status          string `json:"status"` // active | flagged | suspended
	Note            string `json:"note"`
}

// AddStrike increments a user's strike counter (creating the row on first
// violation) and returns the new total.
func (s *Store) AddStrike(userID int64, username string) (int, error) {
	_, err := s.db.Exec(`
		INSERT INTO user_strikes(user_id, username, strikes, last_violation_at, status)
		VALUES(?, ?, 1, ?, 'active')
		ON CONFLICT(user_id) DO UPDATE SET
			strikes = strikes + 1,
			username = excluded.username,
			last_violation_at = excluded.last_violation_at`,
		userID, username, nowUTC())
	if err != nil {
		return 0, err
	}
	var n int
	err = s.db.QueryRow(`SELECT strikes FROM user_strikes WHERE user_id = ?`, userID).Scan(&n)
	return n, err
}

func (s *Store) ListStrikes() ([]Strike, error) {
	rows, err := s.db.Query(`
		SELECT user_id, COALESCE(username,''), strikes, COALESCE(last_violation_at,''),
		       COALESCE(status,'active'), COALESCE(note,'')
		FROM user_strikes ORDER BY strikes DESC, last_violation_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Strike
	for rows.Next() {
		var st Strike
		if err := rows.Scan(&st.UserID, &st.Username, &st.Strikes, &st.LastViolationAt, &st.Status, &st.Note); err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, rows.Err()
}

func (s *Store) GetStrike(userID int64) (Strike, error) {
	var st Strike
	err := s.db.QueryRow(`
		SELECT user_id, COALESCE(username,''), strikes, COALESCE(last_violation_at,''),
		       COALESCE(status,'active'), COALESCE(note,'')
		FROM user_strikes WHERE user_id = ?`, userID).
		Scan(&st.UserID, &st.Username, &st.Strikes, &st.LastViolationAt, &st.Status, &st.Note)
	if err != nil {
		if err.Error() == "sql: no rows in result set" {
			return Strike{}, ErrNotFound
		}
		return Strike{}, err
	}
	return st, nil
}

func (s *Store) SetStrikeStatus(userID int64, status, note string) error {
	_, err := s.db.Exec(
		`UPDATE user_strikes SET status = ?, note = ? WHERE user_id = ?`, status, note, userID)
	return err
}

func (s *Store) ResetStrikes(userID int64) error {
	_, err := s.db.Exec(
		`UPDATE user_strikes SET strikes = 0, status = 'active' WHERE user_id = ?`, userID)
	return err
}
