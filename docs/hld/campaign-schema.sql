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
