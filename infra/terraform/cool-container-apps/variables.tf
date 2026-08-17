variable "subscription_id" {
  description = "Nonproduction Azure subscription ID"
  type        = string
  validation {
    condition     = can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.subscription_id))
    error_message = "subscription_id must be a valid lowercase UUID."
  }
}

variable "resource_provider_registrations" {
  description = "Automatic provider registration is disabled"
  type        = string
  default     = "none"
  validation {
    condition     = var.resource_provider_registrations == "none"
    error_message = "The cool profile cannot register providers automatically."
  }
}

variable "resource_providers_to_register" {
  description = "Additional provider registrations are prohibited"
  type        = list(string)
  default     = []
  validation {
    condition     = length(var.resource_providers_to_register) == 0
    error_message = "The cool profile cannot request provider registration."
  }
}

variable "location" {
  description = "Secondary Azure region"
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9]+$", var.location))
    error_message = "location must be a normalized Azure region."
  }
}

variable "resource_group_name" {
  description = "Isolated nonproduction Container Apps profile resource group"
  type        = string
}

variable "managed_environment_name" {
  description = "Container Apps managed environment name"
  type        = string
}

variable "container_app_name" {
  description = "Container App name"
  type        = string
}

variable "managed_identity_resource_id" {
  description = "Existing user-assigned managed identity resource ID"
  type        = string
}

variable "managed_identity_principal_id" {
  description = "Expected managed identity principal ID"
  type        = string
}

variable "key_vault_resource_id" {
  description = "Existing Key Vault resource ID"
  type        = string
}

variable "key_vault_role_definition_id" {
  description = "Key Vault Secrets User role definition resource ID"
  type        = string
}

variable "infrastructure_subnet_resource_id" {
  description = "Dedicated nondelegated Container Apps infrastructure subnet ID"
  type        = string
  validation {
    condition     = endswith(lower(var.infrastructure_subnet_resource_id), "/subnets/snet-container-apps")
    error_message = "infrastructure_subnet_resource_id must reference the dedicated Container Apps subnet."
  }
}

variable "log_analytics_workspace_resource_id" {
  description = "Secondary foundation Log Analytics workspace resource ID"
  type        = string
}

variable "primary_scope" {
  description = "Primary scope retained only for isolation validation"
  type        = string
}

variable "secondary_scope" {
  description = "Secondary profile scope"
  type        = string
}

variable "primary_vnet_cidr" {
  description = "Primary VNet CIDR retained only for isolation validation"
  type        = string
  validation {
    condition     = can(cidrnetmask(var.primary_vnet_cidr))
    error_message = "primary_vnet_cidr must be a valid CIDR."
  }
}

variable "secondary_vnet_cidr" {
  description = "Secondary VNet CIDR"
  type        = string
  validation {
    condition     = can(cidrnetmask(var.secondary_vnet_cidr))
    error_message = "secondary_vnet_cidr must be a valid CIDR."
  }
}

variable "image" {
  description = "Immutable container image digest reference"
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9.-]+/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$", var.image))
    error_message = "image must be an immutable digest reference."
  }
}

variable "revision_mode" {
  description = "Container Apps revision mode"
  type        = string
  default     = "Single"
  validation {
    condition     = var.revision_mode == "Single"
    error_message = "revision_mode must be Single."
  }
}

variable "target_port" {
  description = "Internal ingress target port"
  type        = number
  validation {
    condition     = var.target_port >= 1 && var.target_port <= 65535
    error_message = "target_port must be a valid TCP port."
  }
}

variable "transport" {
  description = "Container Apps ingress transport"
  type        = string
  default     = "auto"
  validation {
    condition     = contains(["auto", "http", "http2", "tcp"], var.transport)
    error_message = "transport must be auto, http, http2, or tcp."
  }
}

variable "min_replicas" {
  description = "Minimum replicas for the cool footprint"
  type        = number
  default     = 0
  validation {
    condition     = var.min_replicas == 0 || var.min_replicas == 1
    error_message = "min_replicas must be 0 or 1."
  }
}

variable "max_replicas" {
  description = "Maximum replicas for the cool footprint"
  type        = number
  default     = 1
  validation {
    condition     = var.max_replicas >= 1 && var.max_replicas <= 3
    error_message = "max_replicas must be between 1 and 3."
  }
}

variable "cpu" {
  description = "Container vCPU"
  type        = number
  default     = 0.25
  validation {
    condition     = contains([0.25, 0.5, 0.75, 1], var.cpu)
    error_message = "cpu is outside the minimum viable cool profile choices."
  }
}

variable "memory" {
  description = "Container memory"
  type        = string
  default     = "0.5Gi"
  validation {
    condition     = contains(["0.5Gi", "1Gi", "1.5Gi", "2Gi"], var.memory)
    error_message = "memory is outside the minimum viable cool profile choices."
  }
}

variable "secret_references" {
  description = "Key Vault references only; secret values are prohibited"
  type = list(object({
    name                 = string
    key_vault_secret_uri = string
    identity_resource_id = string
  }))
  validation {
    condition = alltrue([
      for secret in var.secret_references :
      can(regex("^https://[a-z0-9-]+\\.vault\\.azure\\.net/secrets/[A-Za-z0-9-]+/[0-9a-f]{32}$", secret.key_vault_secret_uri))
    ])
    error_message = "Every secret must use a versioned Key Vault reference."
  }
}

variable "secret_environment_variables" {
  description = "Environment variables bound to secret reference names"
  type = list(object({
    name       = string
    secret_ref = string
  }))
}

variable "probes" {
  description = "Startup, readiness, and liveness probe definitions"
  type = list(object({
    type                  = string
    transport             = string
    path                  = string
    port                  = number
    initial_delay_seconds = number
    interval_seconds      = number
    timeout_seconds       = number
    failure_threshold     = number
  }))
}

variable "diagnostic_setting_name" {
  description = "Diagnostic setting name"
  type        = string
}

variable "decision_digest" {
  description = "Canonical provider-equivalent decision digest"
  type        = string
  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.decision_digest))
    error_message = "decision_digest must be a SHA-256 digest."
  }
}

variable "source_digest" {
  description = "Exact Terraform source digest"
  type        = string
  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.source_digest))
    error_message = "source_digest must be a SHA-256 digest."
  }
}

variable "tags" {
  description = "Additional tags"
  type        = map(string)
  default     = {}
}
