package security

import (
	"testing"
	"time"
)

func TestPINShapeAndLeadingZero(t *testing.T) {
	for _, pin := range []string{"1234", "0000", "0123"} {
		if !pinValid(pin) {
			t.Fatal("rejected valid PIN")
		}
	}
	for _, pin := range []string{"", "123", "12345", "１２３４", "1e03", " 123", "12a4"} {
		if pinValid(pin) {
			t.Fatal("accepted malformed PIN")
		}
	}
}
func TestRecoveryCodesAndHash(t *testing.T) {
	a, b := recoveryCode(), recoveryCode()
	if a == b || len(a) != 39 || len(normalizeRecovery(a)) != 32 {
		t.Fatal("invalid recovery entropy/shape")
	}
	if !matches(hash(normalizeRecovery(a)), hash(normalizeRecovery("  "+a+"  "))) || matches(hash(a), hash(b)) {
		t.Fatal("invalid recovery comparison")
	}
}
func TestProgressiveDelay(t *testing.T) {
	if retryDelay(4) != 0 || retryDelay(5) != time.Minute || retryDelay(6) != 2*time.Minute || retryDelay(100) != 16*time.Minute {
		t.Fatal("invalid retry policy")
	}
}
