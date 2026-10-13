import { authApi, type AuthUser } from './api/client'

export interface AuthSession extends AuthUser { isAuthenticated: true }
export type RegisterData = { name: string; email: string; phone: string; address: string; password: string }
const session = (user: AuthUser): AuthSession => ({ ...user, isAuthenticated: true })

export const getSession = async (): Promise<AuthSession | null> => {
  try { return session((await authApi.me()).user) }
  catch (error) { if ((error as { status?: number }).status === 401) return null; throw error }
}
export const login = async (email: string, password: string) => session((await authApi.login(email, password)).user)
export const register = async (data: RegisterData) => session((await authApi.register(data)).user)
export const logout = () => authApi.logout()
export const updateProfile = (data: { name: string; phone: string; address: string | null }) => authApi.updateProfile(data).then(result => session(result.user))
