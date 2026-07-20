// ============================================================================
// Budget Alerts
// Alerts at 50%, 80%, and 100% of monthly budget.
// For cost anomaly detection, enable it in the Azure Portal:
// Cost Management → Cost alerts → Anomaly alerts (no ARM resource available).
// See docs/cost-management.md for details.
// ============================================================================

targetScope = 'subscription'

@description('Budget name')
param budgetName string

@description('Monthly budget amount in USD')
param amount int

@description('Email addresses for budget notifications')
param contactEmails string[]

@description('Budget start date (first day of a month in ISO 8601 format, e.g., 2026-01-01T00:00:00Z)')
param startDate string

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: budgetName
  properties: {
    category: 'Cost'
    amount: amount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: startDate
    }
    notifications: {
      fiftyPercent: {
        enabled: true
        threshold: 50
        operator: 'GreaterThan'
        contactEmails: contactEmails
        thresholdType: 'Actual'
      }
      eightyPercent: {
        enabled: true
        threshold: 80
        operator: 'GreaterThan'
        contactEmails: contactEmails
        thresholdType: 'Actual'
      }
      hundredPercent: {
        enabled: true
        threshold: 100
        operator: 'GreaterThan'
        contactEmails: contactEmails
        thresholdType: 'Actual'
      }
      forecastedHundredPercent: {
        enabled: true
        threshold: 100
        operator: 'GreaterThan'
        contactEmails: contactEmails
        thresholdType: 'Forecasted'
      }
    }
  }
}
