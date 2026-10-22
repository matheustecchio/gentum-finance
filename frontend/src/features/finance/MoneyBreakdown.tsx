import { AnalyticsIcon } from "./AnalyticsIcon";
import { useId, useState } from "react";
import { formatMoney } from "../accounts/money";
import type { Row } from "./client";
export function MoneyBreakdown({
  title,
  currency,
  rows,
  total,
  kind,
  onCategory,
  onManage,
}: {
  title: string;
  currency: string;
  rows: Row[];
  total: string;
  kind: "income" | "expense";
  onCategory?: (row: Row) => void;
  onManage?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const sign = kind === "income" ? "+" : "−";
  return (
    <section className="panel money-breakdown" aria-labelledby={id}>
      <div className="money-breakdown-heading">
        <h2 id={id}>
          {title}
          {currency !== "EUR" && <small> · {currency}</small>}
        </h2>
        {onManage ? (
          <button className="money-manage" onClick={onManage}>
            Manage
          </button>
        ) : (
          <>
            <strong>
              {sign}
              {formatMoney(total, currency)}
            </strong>
          </>
        )}
      </div>
      <div className="money-category-card">
        {rows.length === 0 ? (
          <p className="money-empty">
            No {kind === "income" ? "income" : "expenses"} in this period.
          </p>
        ) : (
          <>
            <ul
              className="money-category-list"
              aria-label={`${title} categories in ${currency}`}
            >
              {(expanded ? rows : rows.slice(0, 3)).map((row) => (
                <li
                  key={row.categoryId}
                  aria-label={`${row.name}: ${sign}${formatMoney(row.amount, currency)}, ${row.count} transactions, ${row.percentage}`}
                >
                  <button
                    className="money-category-open"
                    onClick={() => onCategory?.(row)}
                    aria-label={`Open ${row.name} transactions`}
                  >
                    <span
                      className={`money-category-icon ${kind}`}
                      aria-hidden="true"
                      style={{
                        borderColor: /^#[0-9a-f]{6}$/i.test(row.color)
                          ? row.color
                          : undefined,
                      }}
                    >
                      <AnalyticsIcon name={row.name} />
                    </span>
                    <div className="money-category-name">
                      <strong>{row.name}</strong>
                      <small>
                        {row.count}{" "}
                        {row.count === "1" ? "transaction" : "transactions"}
                      </small>
                    </div>
                    <div className="money-category-amount">
                      <strong>
                        {sign}
                        {formatMoney(row.amount, currency)}
                      </strong>
                      <small>{row.percentage}</small>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {rows.length > 3 && (
              <button
                className="money-see-all"
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? "Show less" : "See all"}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
