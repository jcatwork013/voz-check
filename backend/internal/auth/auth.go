package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

var ErrUnauthorized = errors.New("unauthorized")

type ctxKey string

const userCtxKey ctxKey = "voz_user"

// Authenticator issues and validates dashboard JWTs.
type Authenticator struct {
	secret []byte
	ttl    time.Duration
}

func New(secret string) *Authenticator {
	return &Authenticator{secret: []byte(secret), ttl: 7 * 24 * time.Hour}
}

// HashPassword returns a bcrypt hash suitable for storage.
func HashPassword(plain string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	return string(b), err
}

// CheckPassword reports whether plain matches the stored bcrypt hash.
func CheckPassword(hash, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}

type claims struct {
	UserID   int64  `json:"uid"`
	Username string `json:"username"`
	jwt.RegisteredClaims
}

// Issue mints a signed token for a user.
func (a *Authenticator) Issue(userID int64, username string) (string, error) {
	now := time.Now()
	c := claims{
		UserID:   userID,
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(a.ttl)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	return tok.SignedString(a.secret)
}

// Principal is the authenticated identity attached to a request context.
type Principal struct {
	UserID   int64
	Username string
}

func (a *Authenticator) parse(tokenStr string) (Principal, error) {
	c := &claims{}
	tok, err := jwt.ParseWithClaims(tokenStr, c, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrUnauthorized
		}
		return a.secret, nil
	})
	if err != nil || !tok.Valid {
		return Principal{}, ErrUnauthorized
	}
	return Principal{UserID: c.UserID, Username: c.Username}, nil
}

// Middleware enforces a valid Bearer token and stores the principal in context.
func (a *Authenticator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		p, err := a.parse(strings.TrimPrefix(h, "Bearer "))
		if err != nil {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), userCtxKey, p)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// FromContext retrieves the authenticated principal (ok=false if absent).
func FromContext(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(userCtxKey).(Principal)
	return p, ok
}
