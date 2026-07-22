namespace SiteApi.Domain.Exceptions;

public class EntityNotFoundException : DomainException
{
    public EntityNotFoundException(string entityName, int id)
        : base($"{entityName} with id {id} not found.") { }

    public EntityNotFoundException(string entityName, string identifier)
        : base($"{entityName} '{identifier}' not found.") { }
}
