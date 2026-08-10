export function formatMoney(amount: number): string {
  return amount.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatMultiplier(mult: number): string {
  return `${mult.toFixed(2)}×`
}
