# ==============================================================================
# Variables
# ==============================================================================

variable "subscription_id" {
  description = "Azure subscription ID"
  type        = string
  validation {
    condition     = can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.subscription_id))
    error_message = "subscription_id must be a valid UUID."
  }
}

variable "resource_group_name" {
  description = "Resource group to deploy into"
  type        = string
}

variable "location" {
  description = "Azure region"
  type        = string
  default     = "eastus2"
}

variable "app_name" {
  description = "Application name prefix (lowercase alphanumeric, max 12 chars to fit resource naming limits)"
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9]{1,11}$", var.app_name))
    error_message = "app_name must be 2-12 lowercase alphanumeric characters, starting with a letter."
  }
}

variable "environment" {
  description = "Environment: prod or nonprod"
  type        = string
  default     = "prod"
  validation {
    condition     = contains(["prod", "nonprod"], var.environment)
    error_message = "Environment must be 'prod' or 'nonprod'."
  }
}

variable "system_node_vm_size" {
  description = "AKS system node VM size"
  type        = string
  default     = "Standard_D4s_v5"
}

variable "gpu_node_vm_size" {
  description = "GPU node VM size"
  type        = string
  default     = "Standard_NC6s_v3"
}

variable "cpu_node_vm_size" {
  description = "CPU burst node pool VM size"
  type        = string
  default     = "Standard_D4s_v5"
}

variable "gpu_use_spot" {
  description = "Use Spot VMs for GPU node pool"
  type        = bool
  default     = true
}

variable "cpu_use_spot" {
  description = "Use Spot VMs for CPU burst node pool"
  type        = bool
  default     = true
}

variable "kubernetes_version" {
  description = "AKS Kubernetes version"
  type        = string
  default     = "1.30"
}

variable "ssh_public_key" {
  description = "SSH public key for AKS nodes"
  type        = string
}

variable "aks_admin_username" {
  description = "Linux admin username for AKS nodes"
  type        = string
  default     = "azureuser"
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default     = {}
}

locals {
  tags = merge({
    environment = var.environment
    team        = "ml-engineering"
    project     = var.app_name
    managedBy   = "terraform"
  }, var.tags)
}
