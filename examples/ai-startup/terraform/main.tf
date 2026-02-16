# ==============================================================================
# AI Startup Example — Terraform
# AKS with GPU Spot node pools + Azure OpenAI + Blob Storage + Redis
# ==============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
    key_vault {
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
  }
  subscription_id = var.subscription_id
}

# ==============================================================================
# Variables
# ==============================================================================

variable "subscription_id" {
  description = "Azure subscription ID"
  type        = string
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
  description = "Application name prefix"
  type        = string
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

variable "kubernetes_version" {
  description = "AKS Kubernetes version"
  type        = string
  default     = "1.30"
}

variable "ssh_public_key" {
  description = "SSH public key for AKS nodes"
  type        = string
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
  }, var.tags)
}

# ==============================================================================
# Data source for existing resource group
# ==============================================================================

data "azurerm_resource_group" "this" {
  name = var.resource_group_name
}

data "azurerm_client_config" "current" {}

# ==============================================================================
# Log Analytics
# ==============================================================================

resource "azurerm_log_analytics_workspace" "this" {
  name                = "law-${var.app_name}-${var.environment}"
  location            = var.location
  resource_group_name = data.azurerm_resource_group.this.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

# ==============================================================================
# AKS Cluster
# ==============================================================================

resource "azurerm_kubernetes_cluster" "this" {
  name                = "aks-${var.app_name}-${var.environment}"
  location            = var.location
  resource_group_name = data.azurerm_resource_group.this.name
  dns_prefix          = "${var.app_name}-${var.environment}"
  kubernetes_version  = var.kubernetes_version
  tags                = local.tags

  identity {
    type = "SystemAssigned"
  }

  default_node_pool {
    name                 = "system"
    vm_size              = var.system_node_vm_size
    min_count            = 2
    max_count            = 5
    auto_scaling_enabled = true
    os_sku               = "AzureLinux"
  }

  network_profile {
    network_plugin = "azure"
    network_policy = "calico"
    service_cidr   = "172.16.0.0/16"
    dns_service_ip = "172.16.0.10"
  }

  oms_agent {
    log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id
  }

  linux_profile {
    admin_username = "azureuser"
    ssh_key {
      key_data = var.ssh_public_key
    }
  }
}

# GPU Spot node pool — separate resource for independent scaling
resource "azurerm_kubernetes_cluster_node_pool" "gpu" {
  name                  = "gpu"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.this.id
  vm_size               = var.gpu_node_vm_size
  min_count             = 0
  max_count             = 3
  auto_scaling_enabled  = true
  os_sku                = "AzureLinux"
  priority              = var.gpu_use_spot ? "Spot" : "Regular"
  eviction_policy       = var.gpu_use_spot ? "Delete" : null
  spot_max_price        = var.gpu_use_spot ? -1 : null
  node_taints           = ["sku=gpu:NoSchedule"]

  node_labels = {
    "accelerator"   = "nvidia"
    "workload-type" = "gpu"
  }

  tags = local.tags
}

# CPU burst node pool for data preprocessing
resource "azurerm_kubernetes_cluster_node_pool" "cpu" {
  name                  = "cpu"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.this.id
  vm_size               = var.cpu_node_vm_size
  min_count             = 0
  max_count             = 10
  auto_scaling_enabled  = true
  os_sku                = "AzureLinux"
  priority              = "Spot"
  eviction_policy       = "Delete"
  spot_max_price        = -1

  node_labels = {
    "workload-type" = "cpu-batch"
  }

  tags = local.tags
}

# ==============================================================================
# Azure Container Registry
# ==============================================================================

resource "azurerm_container_registry" "this" {
  name                = replace("acr${var.app_name}${var.environment}", "-", "")
  location            = var.location
  resource_group_name = data.azurerm_resource_group.this.name
  sku                 = "Standard"
  admin_enabled       = false
  tags                = local.tags
}

# Grant AKS pull access to ACR (AcrPull role)
resource "azurerm_role_assignment" "aks_acr_pull" {
  scope                = azurerm_container_registry.this.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_kubernetes_cluster.this.kubelet_identity[0].object_id
}

# ==============================================================================
# Azure OpenAI
# ==============================================================================

resource "azurerm_cognitive_account" "openai" {
  name                          = "oai-${var.app_name}-${var.environment}"
  location                      = var.location
  resource_group_name           = data.azurerm_resource_group.this.name
  kind                          = "OpenAI"
  sku_name                      = "S0"
  custom_subdomain_name         = "oai-${var.app_name}-${var.environment}"
  public_network_access_enabled = false
  tags                          = local.tags
}

resource "azurerm_cognitive_deployment" "gpt4o" {
  name                 = "gpt-4o"
  cognitive_account_id = azurerm_cognitive_account.openai.id

  model {
    format  = "OpenAI"
    name    = "gpt-4o"
    version = "2024-08-06"
  }

  sku {
    name     = "Standard"
    capacity = 30
  }
}

# ==============================================================================
# Blob Storage — models, datasets, outputs
# ==============================================================================

resource "azurerm_storage_account" "this" {
  name                            = replace("st${var.app_name}${var.environment}", "-", "")
  location                        = var.location
  resource_group_name             = data.azurerm_resource_group.this.name
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  tags                            = local.tags
}

resource "azurerm_storage_container" "models" {
  name                  = "models"
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
}

resource "azurerm_storage_container" "datasets" {
  name                  = "datasets"
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
}

# ==============================================================================
# Redis — inference caching
# ==============================================================================

resource "azurerm_redis_cache" "this" {
  name                 = "redis-${var.app_name}-${var.environment}"
  location             = var.location
  resource_group_name  = data.azurerm_resource_group.this.name
  capacity             = var.environment == "prod" ? 1 : 0
  family               = "C"
  sku_name             = var.environment == "prod" ? "Standard" : "Basic"
  non_ssl_port_enabled = false
  minimum_tls_version  = "1.2"
  tags                 = local.tags
}

# ==============================================================================
# Key Vault
# ==============================================================================

resource "azurerm_key_vault" "this" {
  name                       = "kv-${var.app_name}-${var.environment}"
  location                   = var.location
  resource_group_name        = data.azurerm_resource_group.this.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  soft_delete_retention_days = 30
  purge_protection_enabled   = var.environment == "prod"
  tags                       = local.tags

  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
  }
}

# ==============================================================================
# Outputs
# ==============================================================================

output "aks_cluster_name" {
  value = azurerm_kubernetes_cluster.this.name
}

output "aks_cluster_fqdn" {
  value = azurerm_kubernetes_cluster.this.fqdn
}

output "acr_login_server" {
  value = azurerm_container_registry.this.login_server
}

output "openai_endpoint" {
  value = azurerm_cognitive_account.openai.endpoint
}

output "storage_account_name" {
  value = azurerm_storage_account.this.name
}

output "redis_hostname" {
  value = azurerm_redis_cache.this.hostname
}
