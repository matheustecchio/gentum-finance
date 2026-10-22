import type { OverviewData } from "./Overview";

// Current-value FX provenance is independent of the selected history range.
export function WealthEstimateNote({ data }: { data: OverviewData }) {
  if (!data.converted || data.rateError) return null;
  return (
    <small className="chart-note wealth-estimate" role="status">
      Current total estimated · ECB rates {data.rateDate}
      {data.rateCached && " · Cached rates (refresh unavailable)"}
    </small>
  );
}
