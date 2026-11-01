package desktop

import "testing"

func TestPostgresPath(t *testing.T) {
	for _, test := range []struct{ input, want string }{
		{`//?/C:/Program Files/Gentum Finance/postgres`, `C:\Program Files\Gentum Finance\postgres`},
		{`\\?\C:\Gentum Finance\postgres`, `C:\Gentum Finance\postgres`},
		{`\\?\UNC\server\share\postgres`, `\\server\share\postgres`},
		{`//?/UNC/server/share/postgres`, `\\server\share\postgres`},
		{`C:\Gentum Finance\postgres`, `C:\Gentum Finance\postgres`},
		{`\\server\share\postgres`, `\\server\share\postgres`},
		{`relative\postgres`, `relative\postgres`},
	} {
		t.Run(test.input, func(t *testing.T) {
			if got := postgresPath(test.input); got != test.want {
				t.Fatalf("postgresPath(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}
