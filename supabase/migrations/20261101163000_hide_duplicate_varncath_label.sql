update public.map_labels set player_visible=false,updated_at=now()
where text='Varn''cath Expanse' and player_visible=true
and exists(select 1 from public.map_hexes where location_ref='HEX_-7_3' and display_name='VARN''CATH EXPANSE');