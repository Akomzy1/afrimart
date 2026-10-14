-- AlterTable
ALTER TABLE "KitchenLicence" ADD COLUMN     "licenceExpiresOn" DATE,
ADD COLUMN     "verifiedIssuingAuthority" TEXT,
ADD COLUMN     "verifiedLicenceNumber" TEXT;
