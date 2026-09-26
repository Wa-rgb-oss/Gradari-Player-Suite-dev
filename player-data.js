(() => {
  const encode = value => encodeURIComponent(value);

  async function load(session) {
    const userId = session.user.id;
    const uid = encode(userId);

    const [profiles, registrations, wallets, memberships, factions, assets, catalog, characters, actions, transactions] = await Promise.all([
      GMAuth.api("player_profiles?user_id=eq." + uid + "&select=*&limit=1"),
      GMAuth.api("players_tab?user_id=eq." + uid + "&select=*&limit=1"),
      GMAuth.api("player_wallets?user_id=eq." + uid + "&select=*&limit=1"),
      GMAuth.api("faction_memberships?user_id=eq." + uid + "&select=*&order=created_at.asc"),
      GMAuth.api("factions?select=id,code,name,description,treasury,status&order=name.asc"),
      GMAuth.api("player_assets?user_id=eq." + uid + "&select=*&order=updated_at.desc"),
      GMAuth.api("asset_catalog?select=id,code,name,kind,unit,description&order=name.asc"),
      GMAuth.api("characters?user_id=eq." + uid + "&select=*&order=is_main.desc,created_at.asc"),
      GMAuth.api("actions_tab?user_id=eq." + uid + "&select=id,action_title,category,status,created_at,resolution,resolved_at&order=created_at.desc"),
      GMAuth.api("player_transactions?user_id=eq." + uid + "&select=id,amount,currency,kind,description,balance_after,created_at&order=created_at.desc&limit=20")
    ]);

    const factionMap = new Map((factions || []).map(row => [row.id, row]));
    const assetMap = new Map((catalog || []).map(row => [row.id, row]));

    const enrichedMemberships = (memberships || []).map(row => ({
      ...row,
      faction: factionMap.get(row.faction_id) || null
    }));

    const enrichedAssets = (assets || []).map(row => ({
      ...row,
      asset: assetMap.get(row.asset_id) || null
    }));

    return {
      session,
      profile: profiles?.[0] || null,
      registration: registrations?.[0] || null,
      wallet: wallets?.[0] || null,
      memberships: enrichedMemberships,
      primaryMembership: enrichedMemberships.find(row => row.status === "active") || enrichedMemberships[0] || null,
      factions: factions || [],
      assets: enrichedAssets,
      catalog: catalog || [],
      characters: characters || [],
      actions: actions || [],
      transactions: transactions || []
    };
  }

  window.GMPlayerData = { load };
})();