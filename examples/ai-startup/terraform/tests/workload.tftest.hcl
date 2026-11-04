mock_provider "azurerm" {
  mock_data "azurerm_client_config" {
    defaults = {
      tenant_id       = "11111111-1111-1111-1111-111111111111"
      object_id       = "22222222-2222-2222-2222-222222222222"
      subscription_id = "33333333-3333-3333-3333-333333333333"
    }
  }
}

variables {
  subscription_id     = "33333333-3333-3333-3333-333333333333"
  resource_group_name = "rg-ai-test"
  location            = "eastus2"
  app_name            = "aitest"
  ssh_public_key      = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCkblAoeBaEIqk2MXxU9Trc9Il0uTPSTTsnb8hjZhnRhDdwfCzkUr/XBRtZQ4OmdkD7KMFpJ6/Z0f9KtqZ60DJsyg50TtJho4xOPGOlTCbqdGVpnqjCTkFEIcN3H5Q2UwQXDMycP9iuXM05BDG13FZPnnrl3zLFWaSjE161aRAJ2ACEzXfbOzGHwDaCHq99WIK21otcJkb13Yaer2BYtAO1vHQU3gBc2Si/08UIh7iA9qdsM45uwP862gKGX3kEnwzXEaVcdrLLGdfdMxKTanvmKiht+A1txTBXsVEOW5DSdqCJiqWvT+efpWWJLTEbA04Jnc9gcrtyEPrAbuFET45P synthetic-test"
}

run "production_defaults_preserve_workload_and_controls" {
  command = plan

  # AzureRM's mocked AKS kubelet_identity is empty without a live create.
  # Plan workload resources; the AcrPull identity binding needs a live postcheck.
  plan_options {
    target = [
      azurerm_kubernetes_cluster_node_pool.gpu,
      azurerm_kubernetes_cluster_node_pool.cpu,
      azurerm_container_registry.this,
      azurerm_cognitive_deployment.gpt4o,
      azurerm_storage_container.models,
      azurerm_storage_container.datasets,
      azurerm_management_lock.key_vault,
      azurerm_monitor_diagnostic_setting.redis,
    ]
  }

  assert {
    condition = (
      azurerm_kubernetes_cluster.this.default_node_pool[0].auto_scaling_enabled &&
      azurerm_kubernetes_cluster.this.default_node_pool[0].min_count == 2 &&
      azurerm_kubernetes_cluster.this.default_node_pool[0].max_count == 5 &&
      azurerm_kubernetes_cluster.this.default_node_pool[0].vm_size == var.system_node_vm_size
    )
    error_message = "The system pool must retain its selected VM size and 2-5 node autoscaling."
  }

  assert {
    condition = (
      azurerm_kubernetes_cluster_node_pool.gpu.priority == "Spot" &&
      azurerm_kubernetes_cluster_node_pool.gpu.eviction_policy == "Delete" &&
      azurerm_kubernetes_cluster_node_pool.gpu.spot_max_price == -1 &&
      azurerm_kubernetes_cluster_node_pool.gpu.min_count == 0 &&
      azurerm_kubernetes_cluster_node_pool.gpu.max_count == 3 &&
      azurerm_kubernetes_cluster_node_pool.gpu.auto_scaling_enabled &&
      contains(azurerm_kubernetes_cluster_node_pool.gpu.node_taints, "sku=gpu:NoSchedule")
    )
    error_message = "The GPU pool must preserve Spot configuration, 0-3 autoscaling and GPU isolation."
  }

  assert {
    condition = (
      azurerm_kubernetes_cluster_node_pool.cpu.priority == "Spot" &&
      azurerm_kubernetes_cluster_node_pool.cpu.eviction_policy == "Delete" &&
      azurerm_kubernetes_cluster_node_pool.cpu.spot_max_price == -1 &&
      azurerm_kubernetes_cluster_node_pool.cpu.min_count == 0 &&
      azurerm_kubernetes_cluster_node_pool.cpu.max_count == 10 &&
      azurerm_kubernetes_cluster_node_pool.cpu.auto_scaling_enabled
    )
    error_message = "The CPU burst pool must preserve its independent Spot policy and 0-10 autoscaling."
  }

  assert {
    condition = (
      !azurerm_container_registry.this.admin_enabled &&
      !azurerm_cognitive_account.openai.public_network_access_enabled &&
      !azurerm_redis_cache.this.public_network_access_enabled &&
      !azurerm_storage_account.this.allow_nested_items_to_be_public &&
      azurerm_storage_container.models.container_access_type == "private" &&
      azurerm_storage_container.datasets.container_access_type == "private"
    )
    error_message = "Workload planning must preserve disabled registry admin access and private data-service defaults."
  }

  assert {
    condition = (
      azurerm_redis_cache.this.sku_name == "Standard" &&
      azurerm_redis_cache.this.capacity == 1 &&
      azurerm_key_vault.this.purge_protection_enabled &&
      azurerm_key_vault.this.rbac_authorization_enabled &&
      length(azurerm_management_lock.key_vault) == 1 &&
      azurerm_management_lock.key_vault[0].lock_level == "CanNotDelete"
    )
    error_message = "Production must retain Standard Redis, Key Vault RBAC, purge protection and its lock."
  }

  assert {
    condition = (
      azurerm_cognitive_deployment.gpt4o.model[0].name == "gpt-4o" &&
      azurerm_cognitive_deployment.gpt4o.sku[0].capacity == 30 &&
      length(azurerm_monitor_diagnostic_setting.redis.enabled_metric) == 1 &&
      one(azurerm_monitor_diagnostic_setting.redis.enabled_metric).category == "AllMetrics" &&
      output.aks_cluster_name == "aks-aitest-prod"
    )
    error_message = "The model declaration, Redis metrics and cluster-name output must remain intact."
  }
}

run "nonproduction_uses_basic_redis_without_production_lock" {
  command = plan

  plan_options {
    target = [
      azurerm_kubernetes_cluster.this,
      azurerm_redis_cache.this,
      azurerm_key_vault.this,
      azurerm_management_lock.key_vault,
    ]
  }

  variables {
    environment = "nonprod"
  }

  assert {
    condition = (
      azurerm_redis_cache.this.sku_name == "Basic" &&
      azurerm_redis_cache.this.capacity == 0 &&
      !azurerm_key_vault.this.purge_protection_enabled &&
      length(azurerm_management_lock.key_vault) == 0 &&
      output.aks_cluster_name == "aks-aitest-nonprod"
    )
    error_message = "Nonproduction must use Basic Redis and omit the production lock and purge protection."
  }
}

run "on_demand_pools_omit_spot_only_settings" {
  command = plan

  plan_options {
    target = [azurerm_kubernetes_cluster_node_pool.gpu, azurerm_kubernetes_cluster_node_pool.cpu]
  }

  variables {
    gpu_use_spot = false
    cpu_use_spot = false
  }

  assert {
    condition = (
      azurerm_kubernetes_cluster_node_pool.gpu.priority == "Regular" &&
      azurerm_kubernetes_cluster_node_pool.gpu.eviction_policy == null &&
      azurerm_kubernetes_cluster_node_pool.gpu.spot_max_price == null &&
      azurerm_kubernetes_cluster_node_pool.cpu.priority == "Regular" &&
      azurerm_kubernetes_cluster_node_pool.cpu.eviction_policy == null &&
      azurerm_kubernetes_cluster_node_pool.cpu.spot_max_price == null
    )
    error_message = "Regular pools must omit Spot-only eviction and pricing settings."
  }
}

run "pool_choices_are_independent" {
  command = plan

  plan_options {
    target = [azurerm_kubernetes_cluster_node_pool.gpu, azurerm_kubernetes_cluster_node_pool.cpu]
  }

  variables {
    gpu_use_spot = false
    cpu_use_spot = true
  }

  assert {
    condition = (
      azurerm_kubernetes_cluster_node_pool.gpu.priority == "Regular" &&
      azurerm_kubernetes_cluster_node_pool.cpu.priority == "Spot" &&
      contains(azurerm_kubernetes_cluster_node_pool.gpu.node_taints, "sku=gpu:NoSchedule")
    )
    error_message = "GPU and CPU Spot choices must remain independent without losing GPU isolation."
  }
}

run "custom_tags_and_vm_sizes_are_preserved" {
  command = plan

  plan_options {
    target = [azurerm_kubernetes_cluster_node_pool.gpu, azurerm_kubernetes_cluster_node_pool.cpu]
  }

  variables {
    system_node_vm_size = "Standard_D8s_v5"
    gpu_node_vm_size    = "Standard_NC12s_v3"
    cpu_node_vm_size    = "Standard_D8s_v5"
    tags = {
      team = "synthetic-ml"
    }
  }

  assert {
    condition = (
      azurerm_kubernetes_cluster.this.default_node_pool[0].vm_size == "Standard_D8s_v5" &&
      azurerm_kubernetes_cluster_node_pool.gpu.vm_size == "Standard_NC12s_v3" &&
      azurerm_kubernetes_cluster_node_pool.cpu.vm_size == "Standard_D8s_v5" &&
      azurerm_kubernetes_cluster.this.tags["team"] == "synthetic-ml" &&
      azurerm_kubernetes_cluster_node_pool.gpu.tags["managedBy"] == "terraform"
    )
    error_message = "Caller VM sizes and tag overrides must survive workload planning."
  }
}

run "invalid_environment_is_rejected" {
  command = plan

  variables {
    environment = "staging"
  }

  expect_failures = [var.environment]
}

run "invalid_app_name_is_rejected" {
  command = plan

  variables {
    app_name = "INVALID-NAME-TOO-LONG"
  }

  expect_failures = [var.app_name]
}

run "invalid_subscription_is_rejected" {
  command = plan

  override_resource {
    target          = azurerm_kubernetes_cluster.this
    override_during = plan

    values = {
      kubelet_identity = [{
        object_id = "44444444-4444-4444-4444-444444444444"
      }]
    }
  }

  variables {
    subscription_id = "not-a-subscription"
  }

  expect_failures = [var.subscription_id]
}
