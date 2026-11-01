source "https://rubygems.org"

gem "sinatra", ">= 3.0", "< 5"   # two constraints
gem "my_fork", git: "https://example.invalid/team/my_fork.git"
gem "local_gem", path: "../local_gem"
gem "capybara", group: :test
gem "pry", groups: [:development, :test]
gem "sinatra", "~> 2.0"

if ENV["CI"]
  gem "simplecov"
end

platforms :jruby do
  gem "jdbc-postgres"
end

group :test do
  git "https://example.invalid/team/gems.git" do
    gem "inner_test_gem"
  end
  gem "webmock", "~> 3.23"
end

gem "after_blocks", "~> 1.0"
