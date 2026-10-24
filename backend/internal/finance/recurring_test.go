package finance

import "testing"

func TestRecurringCalendarAnchors(t *testing.T) {
	cases := []struct {
		start, frequency, want string
		day, month             int
	}{
		{"2026-01-31", "monthly", "2026-02-28", 31, 1},
		{"2026-02-28", "monthly", "2026-03-31", 31, 1},
		{"2024-02-29", "yearly", "2025-02-28", 29, 2},
		{"2027-02-28", "yearly", "2028-02-29", 29, 2},
		{"2026-03-22", "weekly", "2026-03-29", 22, 3},
		{"2026-12-25", "fortnightly", "2027-01-08", 25, 12},
	}
	for _, c := range cases {
		t.Run(c.start+c.frequency, func(t *testing.T) {
			d, _ := date(c.start)
			got := nextOccurrence(d, c.frequency, c.day, c.month).Format("2006-01-02")
			if got != c.want {
				t.Fatalf("got %s want %s", got, c.want)
			}
		})
	}
}
func TestRecurringImportMatching(t *testing.T) {
	o := Row{"id": "one", "date": "2026-10-10", "accountId": "a", "categoryId": "c", "kind": "EXPENSE", "amount": "9007199254740993", "description": " Subscription "}
	key := recurringKey(o)
	m := &recurringMatcher{byKey: map[string][]Row{key: {o}}, used: map[string]bool{}}
	input := Row{}
	for k, v := range o {
		input[k] = v
	}
	input["description"] = "subscription"
	input["date"] = "2026-10-13"
	got, e := m.match(input)
	if e != nil || got["id"] != "one" {
		t.Fatal(got, e)
	}
	got, e = m.match(input)
	if e != nil || got != nil {
		t.Fatal("reused occurrence", got, e)
	}
	m.used = map[string]bool{}
	input["date"] = "2026-10-14"
	got, e = m.match(input)
	if e != nil || got != nil {
		t.Fatal("matched outside window")
	}
	input["date"] = "2026-10-10"
	m.byKey[key] = append(m.byKey[key], Row{"id": "two", "date": "2026-10-11"})
	if _, e = m.match(input); e == nil {
		t.Fatal("accepted ambiguous match")
	}
}
