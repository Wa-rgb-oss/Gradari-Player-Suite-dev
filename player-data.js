(() => {
  const encode = value => encodeURIComponent(value);

  async function load(session) {
    const userId = session.user.id;
    const uid = encode(userId);

    const [
      profiles, registrations, wallets, memberships, factions, assets, factionAssets, catalog,
      characters, actions, transactions, world, news, config, directory,
      proposals, proposalMembers, factionInvitations, factionTransactions,
      facilityTypes, facilities, markets, marketListings, events,
      eventObjectives, eventParticipation, characterSuccessions,
      resourceCatalog, factionResources, systemEconomies, resourceDeposits,
      facilityConnections, factoryRecipes, factoryOrders, tradeStations
    ] = await Promise.all([
      GMAuth.api("player_profiles?user_id=eq." + uid + "&select=*&limit=1"),
      GMAuth.api("players_tab?user_id=eq." + uid + "&select=*&limit=1"),
      GMAuth.api("player_wallets?user_id=eq." + uid + "&select=*&limit=1"),
      GMAuth.api("faction_memberships?user_id=eq." + uid + "&select=*&order=created_at.asc"),
      GMAuth.api("factions?select=id,code,name,description,treasury,status,leader_user_id,leader_character_id,leadership_status,tax_rate,federal_tax_rate,federal_member,color&order=name.asc"),
      GMAuth.api("player_assets?user_id=eq." + uid + "&select=*&order=updated_at.desc"),
      GMAuth.api("faction_assets?select=*&order=updated_at.desc"),
      GMAuth.api("asset_catalog?select=id,code,name,kind,unit,description&order=name.asc"),
      GMAuth.api("characters?user_id=eq." + uid + "&select=*&order=is_main.desc,created_at.asc"),
      GMAuth.api("actions_tab?user_id=eq." + uid + "&select=id,action_title,category,status,created_at,resolution,resolved_at&order=created_at.desc"),
      GMAuth.api("player_transactions?user_id=eq." + uid + "&select=id,amount,currency,kind,description,balance_after,created_at&order=created_at.desc&limit=30"),
      GMAuth.api("world_state?select=key,label,category,value,updated_at&order=category.asc,key.asc"),
      GMAuth.api("game_news?select=id,title,body,visibility,faction_id,published_at&order=published_at.desc&limit=12"),
      GMAuth.api("game_config?select=*&limit=1"),
      GMAuth.api("player_profiles?is_discoverable=eq.true&select=user_id,display_name&order=display_name.asc"),
      GMAuth.api("faction_proposals?select=*&order=created_at.desc"),
      GMAuth.api("faction_proposal_members?select=*&order=created_at.asc"),
      GMAuth.api("faction_invitations?select=*&order=created_at.desc"),
      GMAuth.api("faction_transactions?select=*&order=created_at.desc&limit=40"),
      GMAuth.api("facility_types?select=*&order=name.asc"),
      GMAuth.api("facilities?select=*&order=created_at.desc"),
      GMAuth.api("markets?select=*&order=name.asc"),
      GMAuth.api("market_listings?select=*&order=created_at.asc"),
      GMAuth.api("game_events?select=*&order=starts_at.asc,created_at.desc"),
      GMAuth.api("event_objectives?select=*&order=sort_order.asc"),
      GMAuth.api("event_participants?user_id=eq." + uid + "&select=*&order=joined_at.desc"),
      GMAuth.api("character_successions?user_id=eq." + uid + "&select=*&order=created_at.desc"),
      GMAuth.api("resource_catalog?select=*&order=category.asc,name.asc").catch(() => []),
      GMAuth.api("faction_resources?select=*&order=resource_code.asc").catch(() => []),
      GMAuth.api("system_economies?select=*").catch(() => []),
      GMAuth.api("map_resource_deposits?select=*&order=location_ref.asc,resource_code.asc").catch(() => []),
      GMAuth.api("facility_connections?select=*").catch(() => []),
      GMAuth.api("factory_recipes?player_visible=eq.true&select=*&order=name.asc").catch(() => []),
      GMAuth.api("factory_orders?select=*").catch(() => []),
      GMAuth.api("trade_station_markets?player_visible=eq.true&select=*").catch(() => [])
    ]);

    const factionMap = new Map((factions || []).map(row => [row.id,row]));
    const assetMap = new Map((catalog || []).map(row => [row.id,row]));
    const marketMap = new Map((markets || []).map(row => [row.id,row]));
    const facilityTypeMap = new Map((facilityTypes || []).map(row => [row.id,row]));

    const enrichedMemberships = (memberships || []).map(row => ({
      ...row,
      faction: factionMap.get(row.faction_id) || null
    }));

    const enrichedAssets = (assets || []).map(row => ({
      ...row,
      asset: assetMap.get(row.asset_id) || null
    }));

    const enrichedListings = (marketListings || []).map(row => ({
      ...row,
      market: marketMap.get(row.market_id) || null,
      asset: assetMap.get(row.asset_id) || null
    }));

    const enrichedFacilities = (facilities || []).map(row => ({
      ...row,
      facility_type: facilityTypeMap.get(row.facility_type_id) || null,
      controlling_faction: factionMap.get(row.controlling_faction_id) || null
    }));

    const eventMap = new Map((events || []).map(row => [row.id,row]));
    const enrichedObjectives = (eventObjectives || []).map(row => ({
      ...row,
      event: eventMap.get(row.event_id) || null,
      reward_asset: assetMap.get(row.reward_asset_id) || null
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
      factionAssets: factionAssets || [],
      catalog: catalog || [],
      characters: characters || [],
      actions: actions || [],
      transactions: transactions || [],
      world: world || [],
      news: news || [],
      config: config?.[0] || null,
      directory: directory || [],
      proposals: proposals || [],
      proposalMembers: proposalMembers || [],
      factionInvitations: factionInvitations || [],
      factionTransactions: factionTransactions || [],
      facilityTypes: facilityTypes || [],
      facilities: enrichedFacilities,
      markets: markets || [],
      marketListings: enrichedListings,
      events: events || [],
      eventObjectives: enrichedObjectives,
      eventParticipation: eventParticipation || [],
      characterSuccessions: characterSuccessions || [],
      resourceCatalog: resourceCatalog || [],
      factionResources: factionResources || [],
      systemEconomies: systemEconomies || [],
      resourceDeposits: resourceDeposits || [],
      facilityConnections: facilityConnections || [],
      factoryRecipes: factoryRecipes || [],
      factoryOrders: factoryOrders || [],
      tradeStations: tradeStations || []
    };
  }

  window.GMPlayerData = { load };
})();