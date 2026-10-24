package finance

import "testing"

func TestHistoryBounds(t *testing.T) {
	for _, f := range []HistoryFilter{{Start: "2026-02-30"}, {End: "bad"}, {Start: "2026-11-01", End: "2026-10-01"}, {SubcategoryID: "child"}} {
		if validateHistory(f) == nil {
			t.Fatalf("accepted %#v", f)
		}
	}
	for _, f := range []HistoryFilter{{}, {Start: "2026-10-01"}, {End: "2026-10-31"}, {Start: "2026-10-01", End: "2026-10-01"}, {CategoryID: "root", SubcategoryID: "child"}} {
		if err := validateHistory(f); err != nil {
			t.Fatal(err)
		}
	}
}

func TestHistoryPaginationBounds(t *testing.T) {
	for _, f := range []HistoryFilter{{Limit: -1}, {Limit: 11}, {Limit: 101}, {Page: -1}, {Page: 1000001}, {Page: 1, After: "cursor"}} {
		if validateHistory(f) == nil {
			t.Fatalf("accepted %#v", f)
		}
	}
	for _, limit := range []int{0, 10, 25, 50, 100} {
		if err := validateHistory(HistoryFilter{Limit: limit, Page: 2}); err != nil {
			t.Fatal(err)
		}
	}
}
