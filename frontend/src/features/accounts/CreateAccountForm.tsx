import { useMutation } from "@apollo/client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  ACCOUNTS_QUERY,
  CREATE_ACCOUNT_MUTATION,
  type AccountType,
} from "./accounts.graphql";

import { toCents } from "./money";

const accountSchema = z.object({
  name: z.string().trim().min(1, "Enter an account name").max(100),
  type: z.enum(["CURRENT", "SAVINGS", "CASH", "CREDIT_CARD"]),
  currency: z.enum(["EUR", "GBP", "USD", "BRL"]),
  initialBalance: z
    .string()
    .trim()
    .superRefine((value, context) => {
      try { toCents(value); } catch (error) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message });
      }
    }),
});

type AccountForm = z.infer<typeof accountSchema>;

export function CreateAccountForm() {
  const [createAccount, { loading, error }] = useMutation(CREATE_ACCOUNT_MUTATION, {
    refetchQueries: [{ query: ACCOUNTS_QUERY }],
  });
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AccountForm>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      name: "",
      type: "CURRENT",
      currency: "EUR",
      initialBalance: "0.00",
    },
  });

  const submit = async (values: AccountForm) => {
    try {
      await createAccount({ variables: { input: { ...values, initialBalance: toCents(values.initialBalance) } } });
      reset();
    } catch {
      // Apollo exposes the error below and the form retains the user's input.
    }
  };

  return (
    <form className="account-form" onSubmit={handleSubmit(submit)}>
      <div className="field field-wide">
        <label htmlFor="account-name">Account name</label>
        <input id="account-name" placeholder="Everyday current account" {...register("name")} />
        {errors.name && <span className="field-error">{errors.name.message}</span>}
      </div>
      <div className="field">
        <label htmlFor="account-type">Type</label>
        <select id="account-type" {...register("type")}>
          <option value="CURRENT">Current</option>
          <option value="SAVINGS">Savings</option>
          <option value="CASH">Cash</option>
          <option value="CREDIT_CARD">Credit card</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="account-currency">Currency</label>
        <select id="account-currency" {...register("currency")}>
          <option value="EUR">EUR</option>
          <option value="GBP">GBP</option>
          <option value="USD">USD</option>
          <option value="BRL">BRL</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="initial-balance">Initial balance</label>
        <input id="initial-balance" inputMode="decimal" {...register("initialBalance")} />
        {errors.initialBalance && (
          <span className="field-error">{errors.initialBalance.message}</span>
        )}
      </div>
      <button type="submit" disabled={loading}>
        {loading ? "Creating…" : "Create account"}
      </button>
      {error && <p className="form-error" role="alert">Account creation failed. Try again.</p>}
    </form>
  );
}

export const accountTypeLabels: Record<AccountType, string> = {
  CURRENT: "Current account",
  SAVINGS: "Savings",
  CASH: "Cash",
  CREDIT_CARD: "Credit card",
};
