// Only display a level asserted by the authenticated Chess session.
export function verificationStatus(profile) {
  if (profile?.verified_human !== true)
    return { verified: false, label: 'Not verified' };
  const level = ['L1', 'L2', 'L3'].includes(profile.kyc_level)
    ? profile.kyc_level
    : null;
  const labels = {
    L1: 'L1 possibly human',
    L2: 'L2 verified human',
    L3: 'L3 verified human',
  };
  return {
    verified: true,
    label: level ? labels[level] : 'Verified human · Level not shared',
  };
}
