# AKS Module Outputs

output "cluster_id" {
  description = "AKS cluster ID"
  value       = azurerm_kubernetes_cluster.main.id
}

output "cluster_name" {
  description = "AKS cluster name"
  value       = azurerm_kubernetes_cluster.main.name
}

output "cluster_fqdn" {
  description = "AKS cluster FQDN"
  value       = azurerm_kubernetes_cluster.main.fqdn
}

output "cluster_private_fqdn" {
  description = "AKS cluster private FQDN"
  value       = azurerm_kubernetes_cluster.main.private_fqdn
}

output "cluster_identity" {
  description = "AKS cluster managed identity"
  value = {
    type         = azurerm_kubernetes_cluster.main.identity[0].type
    principal_id = azurerm_kubernetes_cluster.main.identity[0].principal_id
    tenant_id    = azurerm_kubernetes_cluster.main.identity[0].tenant_id
  }
  sensitive = true
}

output "kubelet_identity" {
  description = "AKS kubelet identity"
  value = {
    client_id   = azurerm_kubernetes_cluster.main.kubelet_identity[0].client_id
    object_id   = azurerm_kubernetes_cluster.main.kubelet_identity[0].object_id
    user_assigned_identity_id = azurerm_kubernetes_cluster.main.kubelet_identity[0].user_assigned_identity_id
  }
  sensitive = true
}

output "kube_config" {
  description = "Kubernetes config"
  value       = azurerm_kubernetes_cluster.main.kube_config_raw
  sensitive   = true
}

output "container_registry_id" {
  description = "Container Registry ID"
  value       = azurerm_container_registry.main.id
}

output "container_registry_login_server" {
  description = "Container Registry login server"
  value       = azurerm_container_registry.main.login_server
}

output "application_gateway_public_ip" {
  description = "Application Gateway public IP"
  value       = azurerm_public_ip.agw.ip_address
}

output "waf_policy_id" {
  description = "Web Application Firewall policy ID"
  value       = azurerm_web_application_firewall_policy.main.id
}

output "node_resource_group" {
  description = "Node resource group name"
  value       = azurerm_kubernetes_cluster.main.node_resource_group
}

output "effective_outbound_ips" {
  description = "Effective outbound IPs for the cluster"
  value       = azurerm_kubernetes_cluster.main.network_profile[0].load_balancer_profile[0].effective_outbound_ips
}