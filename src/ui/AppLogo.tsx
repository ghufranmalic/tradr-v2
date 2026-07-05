import Image from "next/image";

type AppLogoProps = {
  size?: number;
  className?: string;
};

export default function AppLogo({ size = 32, className = "" }: AppLogoProps) {
  const wrapClass = className ? `app-logo-wrap ${className}` : "app-logo-wrap";

  return (
    <span className={wrapClass} style={{ width: size, height: size }}>
      <Image
        src="/logo.png"
        alt="Tradr"
        width={size}
        height={size}
        className="app-logo"
        priority
      />
    </span>
  );
}
