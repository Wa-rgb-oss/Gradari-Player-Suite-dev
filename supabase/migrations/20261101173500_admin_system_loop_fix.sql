do $patch$
declare body text;
begin
 body:=pg_get_functiondef('private.manage_map_system(text,text,text)'::regprocedure);
 body:=replace(body,'declare src public.map_hexes%rowtype; dst public.map_hexes%rowtype;', 'declare item text; src public.map_hexes%rowtype; dst public.map_hexes%rowtype;');
 body:=replace(body,'foreach rec in array movable loop','foreach item in array movable loop');
 body:=replace(body,'foreach rec in array dependent loop','foreach item in array dependent loop');
 body:=replace(body,'foreach rec in array historical loop','foreach item in array historical loop');
 body:=replace(body,',rec)',',item)');
 body:=replace(body,',rec) into',',item) into');
 execute body;
end;$patch$;