import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { meApi } from "../lib/apiClient.js";
import { useAuth } from "../features/auth/AuthContext.jsx";

// Signed avatar URLs live 300 s; refetch a little before they expire.
const PROFILE_STALE_MS = 4 * 60 * 1000;

/** Query key scoped to the signed-in user so data can never leak across accounts. */
export const profileKey = (userId) => ["me", userId];
export const usageKey = (userId) => ["me-usage", userId];

export function useProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: profileKey(user?.id),
    queryFn: ({ signal }) => meApi.get({ signal }),
    enabled: Boolean(user?.id),
    staleTime: PROFILE_STALE_MS,
    refetchInterval: PROFILE_STALE_MS,
    retry: (count, error) => count < 2 && (error?.status === 0 || error?.status >= 500),
  });
}

export function useUsage() {
  const { user } = useAuth();
  return useQuery({
    queryKey: usageKey(user?.id),
    queryFn: ({ signal }) => meApi.usage({ signal }),
    enabled: Boolean(user?.id),
    staleTime: 60_000,
    retry: (count, error) => count < 1 && (error?.status === 0 || error?.status >= 500),
  });
}

/** Shared mutation wiring: write the server's profile into the cache. */
function useProfileMutation(mutationFn) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (profile) => {
      queryClient.setQueryData(profileKey(user?.id), profile);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: profileKey(user?.id) }),
  });
}

export const useUpdateProfile = () => useProfileMutation(meApi.update);
export const useUploadAvatar = () => useProfileMutation(meApi.uploadAvatar);
export const useRemoveAvatar = () => useProfileMutation(meApi.removeAvatar);

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: meApi.deleteAccount,
    onSuccess: () => {
      queryClient.clear();
    },
  });
}
