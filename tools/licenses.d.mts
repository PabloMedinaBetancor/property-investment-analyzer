export interface LicensedPackage {
  name: string;
  version: string;
  license: string;
  texts: string[];
}
export function npmPackages(): LicensedPackage[];
export function cratePackages(): LicensedPackage[];
export function renderLicenses(npm: LicensedPackage[], crates: LicensedPackage[]): string;
export function thirdPartyLicenses(): string;
