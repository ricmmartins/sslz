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
  subscription_id      = "33333333-3333-3333-3333-333333333333"
  resource_group_name  = "rg-api-test"
  location             = "eastus2"
  app_name             = "apitest"
  apim_publisher_email = "publisher@example.invalid"
  apim_publisher_name  = "Synthetic publisher"
}

run "production_has_staging_autoscale_and_scoped_access" {
  command = plan

  assert {
    condition = (
      azurerm_service_plan.this.sku_name == "P1v3" &&
      azurerm_linux_web_app.this.https_only &&
      azurerm_linux_web_app.this.site_config[0].always_on &&
      azurerm_linux_web_app.this.site_config[0].ftps_state == "Disabled" &&
      azurerm_linux_web_app.this.site_config[0].minimum_tls_version == "1.2" &&
      azurerm_linux_web_app.this.site_config[0].auto_heal_setting[0].action[0].action_type == "Recycle" &&
      one(azurerm_linux_web_app.this.site_config[0].auto_heal_setting[0].trigger[0].status_code).status_code_range == "500-599" &&
      one(azurerm_linux_web_app.this.site_config[0].auto_heal_setting[0].trigger[0].status_code).count == 5 &&
      length(azurerm_linux_web_app_slot.staging) == 1 &&
      azurerm_linux_web_app_slot.staging[0].https_only &&
      azurerm_linux_web_app_slot.staging[0].identity[0].type == "SystemAssigned" &&
      azurerm_linux_web_app_slot.staging[0].site_config[0].auto_heal_setting[0].action[0].action_type == "Recycle" &&
      one(azurerm_linux_web_app_slot.staging[0].site_config[0].auto_heal_setting[0].trigger[0].status_code).status_code_range == "500-599"
    )
    error_message = "Production must retain Premium hosting, HTTPS/TLS controls and its managed-identity staging slot."
  }

  assert {
    condition = (
      length(azurerm_cosmosdb_account.this.capabilities) == 0 &&
      azurerm_cosmosdb_sql_container.items.autoscale_settings[0].max_throughput == 4000 &&
      azurerm_cosmosdb_sql_container.items.partition_key_paths == tolist(["/tenantId"]) &&
      azurerm_api_management.this.sku_name == "Consumption_0"
    )
    error_message = "Production Cosmos must use tenant partitioning and autoscale rather than serverless; APIM remains Consumption."
  }

  assert {
    condition = (
      length(azurerm_cosmosdb_sql_role_assignment.staging_cosmos) == 1 &&
      azurerm_role_assignment.app_kv_secrets.role_definition_name == "Key Vault Secrets User" &&
      length(azurerm_role_assignment.staging_kv_secrets) == 1 &&
      azurerm_role_assignment.staging_kv_secrets[0].role_definition_name == "Key Vault Secrets User"
    )
    error_message = "Both production and staging identities must retain their scoped Cosmos and secret-reader roles."
  }

  assert {
    condition = (
      !azurerm_cosmosdb_account.this.public_network_access_enabled &&
      !azurerm_redis_cache.this.public_network_access_enabled &&
      azurerm_redis_cache.this.sku_name == "Standard" &&
      azurerm_redis_cache.this.capacity == 1 &&
      azurerm_key_vault.this.purge_protection_enabled &&
      azurerm_key_vault.this.rbac_authorization_enabled &&
      length(azurerm_management_lock.kv) == 1
    )
    error_message = "Production must preserve private data-service defaults, Standard Redis and protected Key Vault."
  }

  assert {
    condition = (
      azurerm_application_insights.this.application_type == "web" &&
      azurerm_application_insights.this.retention_in_days == 30 &&
      length(azurerm_monitor_diagnostic_setting.redis.enabled_metric) == 1 &&
      one(azurerm_monitor_diagnostic_setting.redis.enabled_metric).category == "AllMetrics"
    )
    error_message = "Application Insights and enabled Redis metrics must remain configured."
  }
}

run "nonproduction_uses_basic_hosting_and_serverless_without_staging" {
  command = plan

  variables {
    environment = "nonprod"
  }

  assert {
    condition = (
      azurerm_service_plan.this.sku_name == "B1" &&
      !azurerm_linux_web_app.this.site_config[0].always_on &&
      azurerm_linux_web_app.this.site_config[0].auto_heal_setting[0].action[0].action_type == "Recycle" &&
      length(azurerm_linux_web_app_slot.staging) == 0 &&
      length(azurerm_cosmosdb_sql_role_assignment.staging_cosmos) == 0 &&
      length(azurerm_role_assignment.staging_kv_secrets) == 0
    )
    error_message = "Nonproduction must omit the staging slot and its role assignments while using Basic hosting."
  }

  assert {
    condition = (
      length(azurerm_cosmosdb_account.this.capabilities) == 1 &&
      one(azurerm_cosmosdb_account.this.capabilities).name == "EnableServerless" &&
      length(azurerm_cosmosdb_sql_container.items.autoscale_settings) == 0 &&
      azurerm_redis_cache.this.sku_name == "Basic" &&
      azurerm_redis_cache.this.capacity == 0 &&
      !azurerm_key_vault.this.purge_protection_enabled &&
      length(azurerm_management_lock.kv) == 0
    )
    error_message = "Nonproduction must use serverless Cosmos and Basic Redis without production-only protection."
  }
}

run "caller_publisher_and_tag_values_are_preserved" {
  command = plan

  variables {
    apim_publisher_name = "Synthetic API team"
    tags = {
      team   = "synthetic-api"
      review = "fixture"
    }
  }

  assert {
    condition = (
      azurerm_api_management.this.publisher_name == "Synthetic API team" &&
      azurerm_api_management.this.publisher_email == var.apim_publisher_email &&
      azurerm_linux_web_app.this.tags["team"] == "synthetic-api" &&
      azurerm_linux_web_app.this.tags["review"] == "fixture" &&
      azurerm_linux_web_app.this.tags["managedBy"] == "terraform"
    )
    error_message = "Publisher settings and caller tag overrides must survive planning."
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

  variables {
    subscription_id = "not-a-subscription"
  }

  expect_failures = [var.subscription_id]
}
