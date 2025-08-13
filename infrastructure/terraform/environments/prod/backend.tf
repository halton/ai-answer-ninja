# Production Backend Configuration
# This file configures the Terraform backend for production state management

terraform {
  backend "azurerm" {
    resource_group_name  = "ai-answer-ninja-terraform-state"
    storage_account_name = "aianswerninjatfstate"
    container_name       = "terraform-state"
    key                 = "prod/terraform.tfstate"
    
    # Enable state locking and consistency checking
    use_msi = true  # Use Managed Service Identity for authentication
  }
}