CREATE TABLE public.campaign_entries (
    id character varying(36) NOT NULL,
    participant_id integer NOT NULL,
    idempotency_key character varying(64) NOT NULL,
    design_id character varying(64) NOT NULL,
    text character varying(64) NOT NULL,
    campaign_day date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.campaign_otps (
    id integer NOT NULL,
    phone character varying(16) NOT NULL,
    code_hash character varying(64),
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL
);
CREATE SEQUENCE public.campaign_otps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.campaign_otps_id_seq OWNED BY public.campaign_otps.id;
CREATE TABLE public.campaign_participants (
    id integer NOT NULL,
    phone character varying(16) NOT NULL,
    email character varying(255) NOT NULL,
    token_version integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.campaign_participants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.campaign_participants_id_seq OWNED BY public.campaign_participants.id;
CREATE TABLE public.campaign_phone_guards (
    phone character varying(16) NOT NULL,
    blocked_until timestamp with time zone,
    block_reason character varying(32),
    failed_verifies integer DEFAULT 0 NOT NULL
);
ALTER TABLE ONLY public.campaign_otps ALTER COLUMN id SET DEFAULT nextval('public.campaign_otps_id_seq'::regclass);
ALTER TABLE ONLY public.campaign_participants ALTER COLUMN id SET DEFAULT nextval('public.campaign_participants_id_seq'::regclass);
ALTER TABLE ONLY public.campaign_entries
    ADD CONSTRAINT campaign_entries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.campaign_otps
    ADD CONSTRAINT campaign_otps_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.campaign_participants
    ADD CONSTRAINT campaign_participants_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.campaign_phone_guards
    ADD CONSTRAINT campaign_phone_guards_pkey PRIMARY KEY (phone);
ALTER TABLE ONLY public.campaign_entries
    ADD CONSTRAINT uq_campaign_entries_participant_key UNIQUE (participant_id, idempotency_key);
CREATE INDEX ix_campaign_entries_campaign_day ON public.campaign_entries USING btree (campaign_day);
CREATE INDEX ix_campaign_entries_participant_id ON public.campaign_entries USING btree (participant_id);
CREATE INDEX ix_campaign_otps_created_at ON public.campaign_otps USING btree (created_at);
CREATE INDEX ix_campaign_otps_phone ON public.campaign_otps USING btree (phone);
CREATE UNIQUE INDEX ix_campaign_participants_phone ON public.campaign_participants USING btree (phone);
ALTER TABLE ONLY public.campaign_entries
    ADD CONSTRAINT campaign_entries_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.campaign_participants(id);
CREATE TABLE public.campaign_draws (
    campaign_day date NOT NULL,
    eligible_entries integer NOT NULL,
    winner_count integer NOT NULL,
    excluded_participants jsonb DEFAULT '[]'::jsonb NOT NULL,
    seed bigint,
    run_by_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.campaign_winners (
    id integer NOT NULL,
    campaign_day date NOT NULL,
    rank integer NOT NULL,
    entry_id character varying(36) NOT NULL,
    participant_id integer NOT NULL,
    tiff_path character varying(1024),
    tiff_error text,
    tiff_generated_at timestamp with time zone
);
CREATE SEQUENCE public.campaign_winners_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.campaign_winners_id_seq OWNED BY public.campaign_winners.id;
ALTER TABLE ONLY public.campaign_winners ALTER COLUMN id SET DEFAULT nextval('public.campaign_winners_id_seq'::regclass);
ALTER TABLE ONLY public.campaign_draws
    ADD CONSTRAINT campaign_draws_pkey PRIMARY KEY (campaign_day);
ALTER TABLE ONLY public.campaign_winners
    ADD CONSTRAINT campaign_winners_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.campaign_winners
    ADD CONSTRAINT campaign_winners_entry_id_key UNIQUE (entry_id);
ALTER TABLE ONLY public.campaign_winners
    ADD CONSTRAINT uq_campaign_winners_day_participant UNIQUE (campaign_day, participant_id);
CREATE INDEX ix_campaign_winners_campaign_day ON public.campaign_winners USING btree (campaign_day);
CREATE INDEX ix_campaign_winners_participant_id ON public.campaign_winners USING btree (participant_id);
ALTER TABLE ONLY public.campaign_winners
    ADD CONSTRAINT campaign_winners_campaign_day_fkey FOREIGN KEY (campaign_day) REFERENCES public.campaign_draws(campaign_day);
ALTER TABLE ONLY public.campaign_winners
    ADD CONSTRAINT campaign_winners_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.campaign_entries(id);
ALTER TABLE ONLY public.campaign_winners
    ADD CONSTRAINT campaign_winners_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.campaign_participants(id);
CREATE TABLE public.campaign_admins (
    id integer NOT NULL,
    username character varying(64) NOT NULL,
    password_hash character varying(255) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    token_version integer DEFAULT 0 NOT NULL,
    failed_logins integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.campaign_admins_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.campaign_admins_id_seq OWNED BY public.campaign_admins.id;
ALTER TABLE ONLY public.campaign_admins ALTER COLUMN id SET DEFAULT nextval('public.campaign_admins_id_seq'::regclass);
ALTER TABLE ONLY public.campaign_admins
    ADD CONSTRAINT campaign_admins_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX ix_campaign_admins_username ON public.campaign_admins USING btree (username);
ALTER TABLE ONLY public.campaign_draws
    ADD CONSTRAINT campaign_draws_run_by_id_fkey FOREIGN KEY (run_by_id) REFERENCES public.campaign_admins(id);
CREATE TABLE public.campaign_designs (
    design_id character varying(64) NOT NULL,
    psd_path character varying(512) NOT NULL,
    width_px integer NOT NULL,
    height_px integer NOT NULL,
    dpi integer NOT NULL,
    text_box jsonb NOT NULL,
    font_path character varying(512),
    font_size integer NOT NULL,
    font_color character varying(16) NOT NULL,
    align character varying(16) NOT NULL,
    placeholder_color character varying(16),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY public.campaign_designs
    ADD CONSTRAINT campaign_designs_pkey PRIMARY KEY (design_id);
