import { GoogleGenAI } from "@google/genai";
import { FinancialSummary } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function getCostReductionTips(summary: FinancialSummary) {
  try {
    const prompt = `
      You are an expert dairy farming consultant. 
      Based on the following financial summary for a dairy farm, provide 3-4 specific, actionable tips to reduce costs and increase profit.
      Note: Farmers spend on Fodder, Medical, Labor, and Electricity.
      
      Financial Summary:
      - Total Income: ₹${summary.totalIncome}
      - Total Expense: ₹${summary.totalExpense}
      - Net Profit: ₹${summary.netProfit}
      - Profit per Liter: ₹${summary.profitPerLiter.toFixed(2)}
      - Expense Breakdown: ${JSON.stringify(summary.expenseBreakdown)}
      
      Format the response as a JSON array of objects with 'title' and 'advice' fields.
      Output ONLY the JSON array.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    return JSON.parse(response.text || "[]");
  } catch (error) {
    console.error("Gemini Error:", error);
    return [];
  }
}
