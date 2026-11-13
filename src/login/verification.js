// Only display a level asserted by the authenticated Chess session.
export function verificationStatus(profile) {
  if (profile?.verified_human !== true)
    return { verified: false, label: 'Not verified' };
  const level = ['L1', 'L2', 'L3'].includes(profile.kyc_level)
    ? profile.kyc_level
    : null;
  return {
    verified: true,
    label: level ? `${level} verified` : 'Verified human · Level not shared',
  };
}
