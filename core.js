export function parseMoneyExpression(expression) {
  const input = String(expression).trim();
  if (!input || !/^[\d\s.,+\-*/()÷x×]+$/i.test(input)) throw new Error("Cálculo inválido");
  const cleaned = input.replace(/[÷]/g, "/").replace(/[x×]/gi, "*");
  const normalized = cleaned.replace(/\d[\d.,]*/g, token => {
    if (token.includes(",")) return token.replace(/\./g, "").replace(",", ".");
    if (/^\d{1,3}(\.\d{3})+$/.test(token)) return token.replace(/\./g, "");
    return token;
  });
  const result = Function(`"use strict"; return (${normalized})`)();
  if (!Number.isFinite(result) || result < 0) throw new Error("Cálculo inválido");
  return Math.round((result + Number.EPSILON) * 100) / 100;
}

export function calculateBalances(expenses, travelers) {
  const balances = Object.fromEntries(travelers.map(name => [name, 0]));
  for (const expense of expenses) {
    const people = expense.participants.filter(name => name in balances);
    if (!people.length || !(expense.paidBy in balances)) continue;
    const share = expense.amount / people.length;
    balances[expense.paidBy] += expense.amount;
    for (const name of people) balances[name] -= share;
  }
  return balances;
}

// Quem paga quem, com o menor número de transferências.
export function settle(balances) {
  const debtors = [], creditors = [];
  for (const [name, value] of Object.entries(balances)) {
    if (value < -0.005) debtors.push({ name, value: -value });
    else if (value > 0.005) creditors.push({ name, value });
  }
  debtors.sort((a, b) => b.value - a.value);
  creditors.sort((a, b) => b.value - a.value);
  const moves = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].value, creditors[j].value);
    moves.push({ from: debtors[i].name, to: creditors[j].name, amount });
    debtors[i].value -= amount;
    creditors[j].value -= amount;
    if (debtors[i].value < 0.005) i += 1;
    if (creditors[j].value < 0.005) j += 1;
  }
  return moves;
}
