import React from 'react'
import { Button, Tooltip } from 'antd'
import type { ButtonProps } from 'antd/es/button'

export interface ActionButtonProps extends ButtonProps {
  tooltip?: string
  confirmText?: string
  onConfirm?: () => void
}

const ActionButton: React.FC<ActionButtonProps> = ({
  tooltip,
  confirmText,
  onConfirm,
  children,
  ...buttonProps
}) => {
  const button = (
    <Button {...buttonProps}>
      {children}
    </Button>
  )

  if (tooltip) {
    return (
      <Tooltip title={tooltip}>
        {button}
      </Tooltip>
    )
  }

  return button
}

export default ActionButton