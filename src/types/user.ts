// ── User Types ──

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface User {
  id: number;
  email: string | null;
  phone: string | null;
  fullName: string;
  mstCode: string | null;
  sapCardCode: string | null;
  sapCardName: string | null;
  language: 'vi' | 'en';
  isActive: boolean;
  approvalStatus: ApprovalStatus;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export interface SignupRequest {
  email?: string;
  phone?: string;
  password: string;
  fullName: string;
  mstCode?: string;
  sapCardCode?: string;
  sapCardName?: string;
}

export interface LoginRequest {
  identifier: string;
  password: string;
}

export interface IdentifyRequest {
  identifier: string;
}

export interface IdentifyResponse {
  exists: boolean;
  identifierType: 'email' | 'phone' | 'mst';
}

export interface AuthSession {
  user: {
    id: number;
    email: string | null;
    phone: string | null;
    fullName: string;
    sapCardCode: string | null;
    sapCardName: string | null;
    language: 'vi' | 'en';
    approvalStatus: ApprovalStatus;
  };
}
