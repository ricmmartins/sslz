output "security_contact_email" {
  description = "Configured security contact email"
  value       = azurerm_security_center_contact.default.email
}
