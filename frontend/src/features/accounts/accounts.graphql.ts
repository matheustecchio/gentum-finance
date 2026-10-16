import { gql } from "@apollo/client";

export const ACCOUNTS_QUERY = gql`
  query Accounts {
    accounts {
      id
      name
      type
      currency
      initialBalance
      archived
    }
  }
`;

export const CREATE_ACCOUNT_MUTATION = gql`
  mutation CreateAccount($input: CreateAccountInput!) {
    createAccount(input: $input) {
      id
      name
      type
      currency
      initialBalance
      archived
    }
  }
`;

export type AccountType = "CURRENT" | "SAVINGS" | "CASH" | "CREDIT_CARD";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  /** Signed integer cents encoded as text to preserve int64 precision. */
  initialBalance: string;
  archived: boolean;
}

export interface AccountsData {
  accounts: Account[];
}
