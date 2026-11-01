# frozen_string_literal: true

source "https://rubygems.org"

ruby "3.3.0"

gem "rails", "~> 7.1.3"
gem "pg", "~> 1.5"
gem "puma", ">= 5.0"
gem "bootsnap", require: false
gem 'jekyll', '~> 4.3'
gemspec

group :development, :test do
  gem "rspec-rails", "~> 6.1"
  gem "debug", platforms: %i[ mri windows ]
end

group :development do
  gem "rubocop", require: false
end
