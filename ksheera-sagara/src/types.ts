export interface Cow {
  id: string;
  name: string;
  tagNumber?: string;
  breed?: string;
  userId: string;
  createdAt: string;
}

export interface MilkSlip {
  id: string;
  cowId?: string;
  userId: string;
  date: string;
  liters: number;
  fat: number;
  snf?: number;
  rate: number;
  amount: number;
  createdAt: string;
}

export type ExpenseCategory = 'Fodder' | 'Medical' | 'Labor' | 'Electricity' | 'Other';

export interface Expense {
  id: string;
  cowId?: string;
  userId: string;
  date: string;
  category: ExpenseCategory;
  amount: number;
  description: string;
  createdAt: string;
}

export interface FinancialSummary {
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  profitPerLiter: number;
  expenseBreakdown: Record<ExpenseCategory, number>;
}
