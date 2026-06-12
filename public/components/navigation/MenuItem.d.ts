export interface MenuItemProps {
  label: string;
  hotkey?: string;
  disabled?: boolean;
  onClick?: () => void;
}
