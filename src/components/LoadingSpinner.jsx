import { SpinnerGap } from "@phosphor-icons/react";

function LoadingSpinner({ size = 17 }) {
  return <span className="loading-spinner" style={{ width: size, height: size }} aria-hidden="true"><SpinnerGap size={size} /></span>;
}

export { LoadingSpinner };
