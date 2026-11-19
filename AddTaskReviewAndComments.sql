BEGIN TRANSACTION;
ALTER TABLE [ProjectTasks] ADD [DueDate] datetime2 NULL;

ALTER TABLE [ProjectTasks] ADD [Priority] int NOT NULL DEFAULT 2;

ALTER TABLE [ProjectTasks] ADD [ReviewedAt] datetime2 NULL;

ALTER TABLE [ProjectTasks] ADD [ReviewedById] int NULL;

CREATE TABLE [TaskComments] (
    [Id] int NOT NULL IDENTITY,
    [TaskId] int NOT NULL,
    [AuthorId] int NOT NULL,
    [Content] nvarchar(max) NOT NULL,
    [CreatedAt] datetime2 NOT NULL,
    CONSTRAINT [PK_TaskComments] PRIMARY KEY ([Id]),
    CONSTRAINT [FK_TaskComments_ProjectTasks_TaskId] FOREIGN KEY ([TaskId]) REFERENCES [ProjectTasks] ([Id]) ON DELETE CASCADE,
    CONSTRAINT [FK_TaskComments_Users_AuthorId] FOREIGN KEY ([AuthorId]) REFERENCES [Users] ([Id]) ON DELETE NO ACTION
);

CREATE INDEX [IX_ProjectTasks_ReviewedById] ON [ProjectTasks] ([ReviewedById]);

CREATE INDEX [IX_TaskComments_AuthorId] ON [TaskComments] ([AuthorId]);

CREATE INDEX [IX_TaskComments_TaskId] ON [TaskComments] ([TaskId]);

ALTER TABLE [ProjectTasks] ADD CONSTRAINT [FK_ProjectTasks_Users_ReviewedById] FOREIGN KEY ([ReviewedById]) REFERENCES [Users] ([Id]) ON DELETE NO ACTION;

INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
VALUES (N'20261118150451_AddTaskReviewAndComments', N'10.0.15');

COMMIT;
GO

