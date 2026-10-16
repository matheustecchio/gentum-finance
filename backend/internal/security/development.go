package security

import "context"

// DevelopmentCurrentUser is a temporary local identity, not authentication.
// Replace this provider with a verified session identity before public access.
type DevelopmentCurrentUser struct{}

func (DevelopmentCurrentUser) UserID(context.Context) (string, error) {
	return "00000000-0000-0000-0000-000000000001", nil
}
