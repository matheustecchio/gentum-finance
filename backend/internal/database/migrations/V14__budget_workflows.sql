CREATE TABLE budget_plan (
 id UUID PRIMARY KEY,
 series_id UUID NOT NULL,
 user_id UUID NOT NULL REFERENCES gentum_user(id),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 currency CHAR(3) NOT NULL CHECK(currency IN ('EUR','GBP','USD','BRL')),
 amount BIGINT NOT NULL CHECK(amount > 0),
 frequency TEXT NOT NULL CHECK(frequency IN ('weekly','monthly','yearly','once')),
 start_date DATE NOT NULL,
 effective_date DATE NOT NULL,
 until_date DATE,
 category_ids UUID[] NOT NULL DEFAULT '{}',
 account_ids UUID[] NOT NULL DEFAULT '{}',
 alert BOOLEAN NOT NULL DEFAULT true,
 CHECK(until_date IS NULL OR until_date >= effective_date),
 UNIQUE(user_id,series_id,effective_date)
);
CREATE INDEX budget_plan_owner ON budget_plan(user_id,effective_date);
INSERT INTO budget_plan(id,series_id,user_id,name,currency,amount,frequency,start_date,effective_date,until_date,category_ids)
 SELECT b.id,b.id,b.user_id,c.name,b.currency,b.amount,'once',b.month,b.month,(b.month + INTERVAL '1 month - 1 day')::date,ARRAY[b.category_id]
 FROM budget b JOIN category c ON c.id=b.category_id AND c.user_id=b.user_id;
