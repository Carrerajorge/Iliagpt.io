import siraLogoSrc from "@/assets/sira-logo.png";

interface IliaGPTLogoProps {
  size?: number;
  className?: string;
}

export function IliaGPTLogo({ size = 32, className = "" }: IliaGPTLogoProps) {
  return (
    <img 
      src={siraLogoSrc} 
      alt="iliagpt logo" 
      width={size} 
      height={size}
      className={`${className} dark:invert dark:brightness-200 dark:contrast-200`}
      style={{ 
        objectFit: "contain",
        mixBlendMode: "multiply",
      }}
    />
  );
}
