import { Type, type Static } from "@sinclair/typebox";

export const UuidSchema = Type.String({ pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$", maxLength: 36 });
export type BrandedUuid<Name extends string> = Static<typeof UuidSchema> & { readonly __brand: Name };
export type HostId = BrandedUuid<"HostId">;
export type ProcessId = BrandedUuid<"ProcessId">;
export type ProcessInstanceId = BrandedUuid<"ProcessInstanceId">;
export type SessionId = BrandedUuid<"SessionId">;
export type RunId = BrandedUuid<"RunId">;
export type EventId = BrandedUuid<"EventId">;
export type CommandId = BrandedUuid<"CommandId">;

export const SafeIntegerSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
export const NonEmptySafeIntegerSchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
