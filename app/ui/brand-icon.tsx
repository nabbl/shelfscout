import Image from "next/image";

export function BrandIcon({ size = 34 }: { size?: number }) {
  return <Image src="/icons/icon-64.png" alt="" aria-hidden="true" width={size} height={size} className="shelfscout-icon" unoptimized />;
}
