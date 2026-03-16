-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER', 'FLEET_ADMIN', 'DRIVER');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('BASIC', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "AgencyStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "FleetStatus" AS ENUM ('INVITED', 'PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DispatcherStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED_TRANSFER', 'SUSPENDED_RESTORATION', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('PENDING', 'ACTIVE', 'ON_LOAD', 'SUSPENDED_TRANSFER', 'SUSPENDED_RESTORATION', 'INACTIVE');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('SEMI', 'FLATBED', 'REEFER', 'BOX_TRUCK', 'TANKER', 'OTHER');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('AVAILABLE', 'ON_LOAD', 'UNDER_MAINTENANCE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "LoadStatus" AS ENUM ('DRAFT', 'ASSIGNED', 'IN_TRANSIT', 'PENDING_DELIVERY_CONFIRMATION', 'DELIVERED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'DISPUTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CHEQUE', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'PARTIAL', 'APPROVED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RelationshipStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "super_admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "super_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agencies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "commissionPercent" DOUBLE PRECISION NOT NULL DEFAULT 8.0,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'BASIC',
    "status" "AgencyStatus" NOT NULL DEFAULT 'ACTIVE',
    "subscriptionExpiresAt" TIMESTAMP(3),
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "agencyAddress" TEXT,
    "agencyPhone" TEXT,
    "agencyEmail" TEXT,
    "footerText" TEXT,
    "customEmailDomain" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_users" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "adminName" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "address" TEXT,
    "logoUrl" TEXT,
    "status" "FleetStatus" NOT NULL DEFAULT 'INVITED',
    "invitedByAgencyId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "registrationToken" TEXT,
    "registrationTokenExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_admins" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleet_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_documents" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_fleet_relationships" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "commissionPercent" DOUBLE PRECISION NOT NULL,
    "status" "RelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_fleet_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatchers" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "phone" TEXT,
    "status" "DispatcherStatus" NOT NULL DEFAULT 'PENDING',
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "totalLoadsCreated" INTEGER NOT NULL DEFAULT 0,
    "totalLoadsCompleted" INTEGER NOT NULL DEFAULT 0,
    "totalLoadsCancelled" INTEGER NOT NULL DEFAULT 0,
    "completionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "onTimeDeliveryRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "podAcceptanceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "disputeRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "autoScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adminRatingAverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overallRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatcher_agency_history" (
    "id" TEXT NOT NULL,
    "dispatcherId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "dispatcher_agency_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatcher_transfer_requests" (
    "id" TEXT NOT NULL,
    "dispatcherId" TEXT NOT NULL,
    "fromAgencyId" TEXT NOT NULL,
    "toAgencyId" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "fromAgencyApprovedAt" TIMESTAMP(3),
    "toAgencyApprovedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "declinedByAgencyId" TEXT,
    "declineReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatcher_transfer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatcher_join_requests" (
    "id" TEXT NOT NULL,
    "dispatcherId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatcher_join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatcher_ratings" (
    "id" TEXT NOT NULL,
    "dispatcherId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "ratedById" TEXT NOT NULL,
    "overallRating" DOUBLE PRECISION NOT NULL,
    "communicationRating" DOUBLE PRECISION NOT NULL,
    "professionalismRating" DOUBLE PRECISION NOT NULL,
    "loadAccuracyRating" DOUBLE PRECISION NOT NULL,
    "reliabilityRating" DOUBLE PRECISION NOT NULL,
    "responsivenessRating" DOUBLE PRECISION NOT NULL,
    "writtenReview" TEXT,
    "dispatcherResponse" TEXT,
    "isFlagged" BOOLEAN NOT NULL DEFAULT false,
    "flagReason" TEXT,
    "flaggedAt" TIMESTAMP(3),
    "removedBySuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "removedAt" TIMESTAMP(3),
    "removedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatcher_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "phone" TEXT,
    "status" "DriverStatus" NOT NULL DEFAULT 'PENDING',
    "licenseNumber" TEXT,
    "licenseClass" TEXT,
    "licenseExpiry" TIMESTAMP(3),
    "profilePhotoUrl" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "rejectionReason" TEXT,
    "totalLoadsCompleted" INTEGER NOT NULL DEFAULT 0,
    "onTimeDeliveryRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "podAcceptanceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "disputeRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overallRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inviteToken" TEXT,
    "inviteTokenExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_documents" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_fleet_history" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "driver_fleet_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_transfer_requests" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "fromFleetId" TEXT NOT NULL,
    "toFleetId" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "fromFleetApprovedAt" TIMESTAMP(3),
    "toFleetApprovedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "declinedByFleetId" TEXT,
    "declineReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_transfer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_join_requests" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "vinNumber" TEXT,
    "vehicleType" "VehicleType" NOT NULL,
    "capacityTons" DOUBLE PRECISION,
    "insuranceExpiry" TIMESTAMP(3),
    "inspectionExpiry" TIMESTAMP(3),
    "status" "VehicleStatus" NOT NULL DEFAULT 'AVAILABLE',
    "maintenanceStartedAt" TIMESTAMP(3),
    "maintenanceReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_records" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "reason" TEXT,
    "notes" TEXT,
    "startedById" TEXT NOT NULL,
    "completedById" TEXT,

    CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loads" (
    "id" TEXT NOT NULL,
    "loadNumber" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "dispatcherId" TEXT NOT NULL,
    "fleetId" TEXT,
    "driverId" TEXT,
    "vehicleId" TEXT,
    "pickupLocation" TEXT NOT NULL,
    "dropoffLocation" TEXT NOT NULL,
    "pickupDate" TIMESTAMP(3) NOT NULL,
    "deliveryDate" TIMESTAMP(3) NOT NULL,
    "loadRate" DOUBLE PRECISION NOT NULL,
    "commissionPercent" DOUBLE PRECISION NOT NULL,
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "dispatcherEarnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fleetEarnings" DOUBLE PRECISION NOT NULL,
    "status" "LoadStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "podFileUrl" TEXT,
    "tripStartedAt" TIMESTAMP(3),
    "deliverySubmittedAt" TIMESTAMP(3),
    "deliveryAcceptedAt" TIMESTAMP(3),
    "deliveryRejectedAt" TIMESTAMP(3),
    "deliveryRejectionReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledByRole" "UserRole",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_status_history" (
    "id" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "status" "LoadStatus" NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" TEXT NOT NULL,
    "changedByRole" "UserRole" NOT NULL,
    "note" TEXT,

    CONSTRAINT "load_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "loadRate" DOUBLE PRECISION NOT NULL,
    "commissionPercent" DOUBLE PRECISION NOT NULL,
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "dispatcherEarnings" DOUBLE PRECISION NOT NULL,
    "fleetEarnings" DOUBLE PRECISION NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amountPaid" DOUBLE PRECISION,
    "paymentMethod" "PaymentMethod",
    "paymentReference" TEXT,
    "paymentDate" TIMESTAMP(3),
    "paymentNotes" TEXT,
    "paidAt" TIMESTAMP(3),
    "recordedById" TEXT,
    "isDisputed" BOOLEAN NOT NULL DEFAULT false,
    "disputeReason" TEXT,
    "disputeRaisedAt" TIMESTAMP(3),
    "disputeResolvedAt" TIMESTAMP(3),
    "disputeResolvedById" TEXT,
    "pdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "loadRate" DOUBLE PRECISION NOT NULL,
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "fleetEarnings" DOUBLE PRECISION NOT NULL,
    "amountPaid" DOUBLE PRECISION NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "paymentReference" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "paymentNotes" TEXT,
    "pdfUrl" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userRole" "UserRole" NOT NULL,
    "token" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deviceInfo" TEXT,
    "ipAddress" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agencyUserId" TEXT,
    "dispatcherId" TEXT,
    "fleetAdminId" TEXT,
    "driverId" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "failed_login_attempts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "failed_login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" "UserRole" NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ipAddress" TEXT,
    "deviceInfo" TEXT,
    "agencyId" TEXT,
    "impersonatedBySuperAdminId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userRole" "UserRole" NOT NULL,
    "agencyId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plan_configs" (
    "id" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL,
    "monthlyPrice" DOUBLE PRECISION NOT NULL,
    "maxDispatchers" INTEGER NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plan_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "super_admins_email_key" ON "super_admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_contactEmail_key" ON "agencies"("contactEmail");

-- CreateIndex
CREATE UNIQUE INDEX "agency_users_email_key" ON "agency_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "fleets_email_key" ON "fleets"("email");

-- CreateIndex
CREATE UNIQUE INDEX "fleets_registrationToken_key" ON "fleets"("registrationToken");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_admins_fleetId_key" ON "fleet_admins"("fleetId");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_admins_email_key" ON "fleet_admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "agency_fleet_relationships_agencyId_fleetId_key" ON "agency_fleet_relationships"("agencyId", "fleetId");

-- CreateIndex
CREATE UNIQUE INDEX "dispatchers_email_key" ON "dispatchers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "dispatcher_ratings_dispatcherId_agencyId_key" ON "dispatcher_ratings"("dispatcherId", "agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_email_key" ON "drivers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_inviteToken_key" ON "drivers"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plateNumber_key" ON "vehicles"("plateNumber");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_vinNumber_key" ON "vehicles"("vinNumber");

-- CreateIndex
CREATE UNIQUE INDEX "loads_loadNumber_key" ON "loads"("loadNumber");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_loadId_key" ON "invoices"("loadId");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_receiptNumber_key" ON "receipts"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_invoiceId_key" ON "receipts"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_isActive_idx" ON "sessions"("userId", "isActive");

-- CreateIndex
CREATE INDEX "failed_login_attempts_email_attemptedAt_idx" ON "failed_login_attempts"("email", "attemptedAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_timestamp_idx" ON "audit_logs"("actorId", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_agencyId_timestamp_idx" ON "audit_logs"("agencyId", "timestamp");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- CreateIndex
CREATE UNIQUE INDEX "platform_settings_key_key" ON "platform_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plan_configs_plan_key" ON "subscription_plan_configs"("plan");

-- AddForeignKey
ALTER TABLE "agency_users" ADD CONSTRAINT "agency_users_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_admins" ADD CONSTRAINT "fleet_admins_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_documents" ADD CONSTRAINT "fleet_documents_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_fleet_relationships" ADD CONSTRAINT "agency_fleet_relationships_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_fleet_relationships" ADD CONSTRAINT "agency_fleet_relationships_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatchers" ADD CONSTRAINT "dispatchers_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatcher_agency_history" ADD CONSTRAINT "dispatcher_agency_history_dispatcherId_fkey" FOREIGN KEY ("dispatcherId") REFERENCES "dispatchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatcher_transfer_requests" ADD CONSTRAINT "dispatcher_transfer_requests_dispatcherId_fkey" FOREIGN KEY ("dispatcherId") REFERENCES "dispatchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatcher_transfer_requests" ADD CONSTRAINT "dispatcher_transfer_requests_fromAgencyId_fkey" FOREIGN KEY ("fromAgencyId") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatcher_transfer_requests" ADD CONSTRAINT "dispatcher_transfer_requests_toAgencyId_fkey" FOREIGN KEY ("toAgencyId") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatcher_join_requests" ADD CONSTRAINT "dispatcher_join_requests_dispatcherId_fkey" FOREIGN KEY ("dispatcherId") REFERENCES "dispatchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatcher_join_requests" ADD CONSTRAINT "dispatcher_join_requests_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatcher_ratings" ADD CONSTRAINT "dispatcher_ratings_dispatcherId_fkey" FOREIGN KEY ("dispatcherId") REFERENCES "dispatchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_fleet_history" ADD CONSTRAINT "driver_fleet_history_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_transfer_requests" ADD CONSTRAINT "driver_transfer_requests_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_join_requests" ADD CONSTRAINT "driver_join_requests_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loads" ADD CONSTRAINT "loads_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loads" ADD CONSTRAINT "loads_dispatcherId_fkey" FOREIGN KEY ("dispatcherId") REFERENCES "dispatchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loads" ADD CONSTRAINT "loads_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "fleets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loads" ADD CONSTRAINT "loads_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loads" ADD CONSTRAINT "loads_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_status_history" ADD CONSTRAINT "load_status_history_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "loads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "loads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_agencyUserId_fkey" FOREIGN KEY ("agencyUserId") REFERENCES "agency_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_dispatcherId_fkey" FOREIGN KEY ("dispatcherId") REFERENCES "dispatchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_fleetAdminId_fkey" FOREIGN KEY ("fleetAdminId") REFERENCES "fleet_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
